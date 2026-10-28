/**
 * Test set, built independently of the training pipeline:
 *   compose   gpt-6.1-sol writes inputs from held-out tag lists and personas
 *   label A|B two blind labelling passes (neither sees the other)
 *   judge     a stronger pass settles span/tag disagreements
 *   fields    Sol computes expected task fields from the text and a
 *             reference time, without our resolver
 *   build     testset/test.jsonl for gen/evaluate.ts
 * Usage: bun gen/testset.ts <step> [arg] [concurrency=6]
 * Everything lives in data/test/.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { resolveFields } from "../../src/fields";
import { parseMarkup, toMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import {
  answeredFields,
  DATE_FIELDS_SCHEMA,
  dateMismatches,
  FOCUS_CALLS,
  isMarkupOf,
  itemsSchema,
  LABELS_SCHEMA,
  ROOT,
  readJsonl,
  readSeeds,
  rng,
  writeInputs,
  writeJsonl,
} from "./common";
import { EXAMPLES } from "./examples";
import { tidy } from "./validate";

const DIR = `${ROOT}data/test/`;
await mkdir(DIR, { recursive: true });
const spec = await readFile(`${ROOT}SPEC.md`, "utf8");
const [step = "compose", arg = "", concurrencyArg = "6"] =
  process.argv.slice(2);
/** Sol is rate-limited per account; a few calls at a time keep it moving. */
const CONCURRENCY = Number(concurrencyArg);
const random = rng(4242);
const pick = <T>(items: readonly T[]) =>
  items[Math.floor(random() * items.length)] as T;

interface TestInput {
  focus: string;
  id: string;
  now: string;
  tagList: string[];
  text: string;
}

// --- compose -----------------------------------------------------------------

/** Reference times: ordinary days plus month/year ends, late nights and DST. */
const NOWS = [
  "2026-10-23T10:00:00-04:00[America/New_York]",
  "2026-10-31T23:30:00-04:00[America/New_York]",
  "2026-11-01T08:15:00-05:00[America/New_York]",
  "2026-12-31T16:45:00-08:00[America/Los_Angeles]",
  "2027-01-04T07:05:00-08:00[America/Los_Angeles]",
  "2027-02-26T13:20:00+00:00[Europe/London]",
  "2027-02-28T21:00:00-06:00[America/Chicago]",
  "2027-03-14T09:40:00-04:00[America/New_York]",
  "2027-04-30T18:10:00+09:00[Asia/Tokyo]",
  "2027-06-15T12:00:00+10:00[Australia/Sydney]",
  "2027-07-04T01:30:00-04:00[America/New_York]",
  "2027-08-20T15:55:00+02:00[Europe/Berlin]",
  "2027-09-30T11:11:00-06:00[America/Denver]",
  "2027-11-25T06:00:00-05:00[America/New_York]",
];

async function compose() {
  const out = `${DIR}inputs.jsonl`;
  if (existsSync(out)) {
    console.log("inputs.jsonl exists; delete it to recompose");
    return;
  }
  const { personas, tagSets } = await readSeeds("test");
  const rows: TestInput[] = [];
  await pool(
    "compose",
    FOCUS_CALLS.map((focus, call) => async () => {
      const items = Array.from({ length: 10 }, () => ({
        persona: pick(personas),
        tagList: [...pick(tagSets)].sort(() => random() - 0.5),
      }));
      for (const { item, text } of await writeInputs(focus, items)) {
        rows.push({
          focus: focus.split(":")[0] ?? focus,
          id: `test/${call}/${item}`,
          now: pick(NOWS),
          tagList: items[item - 1]?.tagList ?? [],
          text,
        });
      }
    }),
    16
  );
  await writeJsonl(out, rows);
  console.log(`${rows.length} test inputs`);
}

// --- label -------------------------------------------------------------------

function labelPrompt(items: { tagList: string[]; text: string }[]) {
  return `You label evaluation data for a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${EXAMPLES}

## Your job

Label each item's text exactly as the spec requires and choose its tags.
- Your markup's plain text must equal the item's text exactly, character for character. Only insert [X: and ].
- Tags only from that item's list, spelled exactly, and only when the spec's rules justify them.
Return one entry per item with "item" set to its number.

${items.map((item, index) => `Item ${index + 1}\n  tags list: ${JSON.stringify(item.tagList)}\n  text: ${JSON.stringify(item.text)}`).join("\n\n")}`;
}

async function label(pass: string) {
  const inputs = await readJsonl<TestInput>(`${DIR}inputs.jsonl`);
  const out = `${DIR}labels-${pass}.jsonl`;
  const rows = await readJsonl<Label>(out);
  const done = new Set(rows.map((row) => row.id));
  // Different batching per pass so context effects differ.
  const order = inputs.filter((input) => !done.has(input.id));
  const shuffle = rng(pass === "A" ? 1 : 2);
  order.sort(() => shuffle() - 0.5);
  const BATCH = 15;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < order.length; first += BATCH) {
    const batch = order.slice(first, first + BATCH);
    jobs.push(async () => {
      const result = await codexJson<{
        items: { item: number; marked: string; tags: string[] }[];
      }>({
        effort: "high",
        model: "gpt-6.1-sol",
        prompt: labelPrompt(batch),
        schema: LABELS_SCHEMA,
      });
      for (const entry of result.items) {
        const input = batch[entry.item - 1];
        if (input) {
          rows.push({
            id: input.id,
            marked: entry.marked,
            tags: entry.tags,
            valid: isMarkupOf(entry.marked, input.text),
          });
        }
      }
      await writeJsonl(out, rows);
    });
  }
  await pool(`label ${pass}`, jobs, CONCURRENCY);
  console.log(`pass ${pass}: ${rows.length} labels`);
}

// --- judge -------------------------------------------------------------------

interface Label {
  id: string;
  marked: string;
  tags: string[];
  valid: boolean;
}

/** Markup with the validator's deterministic edge clean-up applied. */
function canonical(marked: string) {
  const { spans, text } = parseMarkup(marked);
  return toMarkup(
    text,
    spans.map((span) => tidy(span, text)).filter((span) => span.text)
  );
}

function sameTags(a: string[], b: string[]) {
  return (
    JSON.stringify([...new Set(a)].sort()) ===
    JSON.stringify([...new Set(b)].sort())
  );
}

async function judge() {
  const inputs = await readJsonl<TestInput>(`${DIR}inputs.jsonl`);
  const passes = await Promise.all(
    ["A", "B"].map(async (pass) => {
      const rows = await readJsonl<Label>(`${DIR}labels-${pass}.jsonl`);
      return new Map(rows.map((row) => [row.id, row]));
    })
  );
  const out = `${DIR}gold.jsonl`;
  const gold = await readJsonl<{ id: string } & Record<string, unknown>>(out);
  const done = new Set(gold.map((row) => row.id));
  const disputes: { a: Label; b: Label; input: TestInput }[] = [];
  for (const input of inputs) {
    const a = passes[0]?.get(input.id);
    const b = passes[1]?.get(input.id);
    if (done.has(input.id) || !(a?.valid && b?.valid)) {
      continue;
    }
    const tagList = new Set(input.tagList);
    a.tags = a.tags.filter((tag) => tagList.has(tag));
    b.tags = b.tags.filter((tag) => tagList.has(tag));
    if (
      canonical(a.marked) === canonical(b.marked) &&
      sameTags(a.tags, b.tags)
    ) {
      gold.push({
        ...input,
        agreement: "both",
        marked: canonical(a.marked),
        tags: a.tags,
      });
    } else {
      disputes.push({ a, b, input });
    }
  }
  console.log(`${gold.length - done.size} agreed, ${disputes.length} disputed`);
  await writeJsonl(out, gold);
  const schema = itemsSchema({
    marked: { type: "string" },
    reason: { type: "string" },
    tags: { items: { type: "string" }, type: "array" },
  });
  const BATCH = 8;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < disputes.length; first += BATCH) {
    const batch = disputes.slice(first, first + BATCH);
    jobs.push(async () => {
      const prompt = `You are the final judge for evaluation labels of a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${EXAMPLES}

## Your job

Two annotators labelled each item independently and disagreed. Decide the correct labelling under the spec. You may pick either, combine them, or write your own. Be exact about span boundaries and tags; "reason" briefly says what decided it.
- Your markup's plain text must equal the item's text exactly.
- Tags only from that item's list, spelled exactly.

${batch
  .map(
    ({ a: one, b: two, input }, index) =>
      `Item ${index + 1}\n  tags list: ${JSON.stringify(input.tagList)}\n  text: ${JSON.stringify(input.text)}\n  annotator 1: ${one.marked} → tags ${JSON.stringify(one.tags)}\n  annotator 2: ${two.marked} → tags ${JSON.stringify(two.tags)}`
  )
  .join("\n\n")}`;
      const result = await codexJson<{
        items: {
          item: number;
          marked: string;
          reason: string;
          tags: string[];
        }[];
      }>({ effort: "xhigh", model: "gpt-6.1-sol", prompt, schema });
      for (const entry of result.items) {
        const dispute = batch[entry.item - 1];
        if (!(dispute && isMarkupOf(entry.marked, dispute.input.text))) {
          continue;
        }
        const tagList = new Set(dispute.input.tagList);
        gold.push({
          ...dispute.input,
          agreement: "judged",
          annotators: [dispute.a.marked, dispute.b.marked],
          marked: canonical(entry.marked),
          reason: entry.reason,
          tags: entry.tags.filter((tag) => tagList.has(tag)),
        });
      }
      await writeJsonl(out, gold);
    });
  }
  await pool("judge", jobs, CONCURRENCY);
  console.log(`${gold.length} gold`);
}

// --- fields ------------------------------------------------------------------

interface Gold extends TestInput {
  marked: string;
  tags: string[];
}

async function fields() {
  const gold = await readJsonl<Gold>(`${DIR}gold.jsonl`);
  const out = `${DIR}fields.jsonl`;
  const rows = await readJsonl<{ id: string; independent: object }>(out);
  const done = new Set(rows.map((row) => row.id));
  const todo = gold.filter((row) => !done.has(row.id));
  const BATCH = 12;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < todo.length; first += BATCH) {
    const batch = todo.slice(first, first + BATCH);
    jobs.push(async () => {
      const prompt = `You compute the expected date fields of tasks for an evaluation set. Do not run any commands; answer only with the JSON object.

Each item is labelled quick-add text (labels per the spec below) and the moment it was typed ("now", with its time zone). Work out, from the labelled S (start), U (due), R (repeat) and M (duration) spans:
- startDate (YYYY-MM-DD) and startTime (HH:MM:SS, or null when no time of day was given)
- dueDate (YYYY-MM-DD)
- durationMinutes (integer; from M, or from an explicit clock range in S like "2-2:30" when there is no M)
- recurrence in this schema, or null: {freq: DAILY|WEEKLY|MONTHLY|YEARLY, interval, byDay (WEEKLY only: weekday codes), byMonthDay (MONTHLY only: one day 1-31), count, until (YYYY-MM-DD)}; unused keys null. If the repeat can't be expressed (e.g. "first monday of each month", hourly), recurrence is null but startDate is still its first occurrence. A repeating task's startDate is its first occurrence (on or after now; anchored by an S "starting ..." or a U inside each cycle when present) and startTime its time.
Conventions: a bare weekday means the next one on or after today (today itself if it's that weekday); "next <weekday>" means the coming one, not the week after; bare hours 1-7 without am/pm are pm, 8-11 am; day parts: morning 09:00, afternoon 13:00, evening 18:00, night/tonight 20:00; "in N days/weeks" keeps no time of day, "in N hours/minutes" does; end of week = Sunday; eod/cob = today; dates already past this year roll to next year. A phrase that names no concrete date (e.g. "after the meeting") gives null.

## Spec (for the labels)

${spec}

## Items

${batch
  .map(
    (row, index) =>
      `Item ${index + 1}\n  now: ${row.now} (${Temporal.ZonedDateTime.from(row.now).toLocaleString("en-US", { weekday: "long" })})\n  labelled: ${row.marked}`
  )
  .join("\n\n")}`;
      const result = await codexJson<{
        items: (Record<string, unknown> & { item: number })[];
      }>({
        effort: "high",
        model: "gpt-6.1-sol",
        prompt,
        schema: DATE_FIELDS_SCHEMA,
      });
      for (const entry of result.items) {
        const row = batch[entry.item - 1];
        if (row) {
          rows.push({ id: row.id, independent: answeredFields(entry) });
        }
      }
      await writeJsonl(out, rows);
    });
  }
  await pool("fields", jobs, CONCURRENCY);
  console.log(`${rows.length} computed`);
}

// --- build -------------------------------------------------------------------

/**
 * testset/test.jsonl for gen/evaluate.ts: gold labels with the fields our
 * resolvers give for them, so the set measures the model. Items where the
 * resolvers disagree with the independent field check (fields) are left out
 * until that is settled; the check reruns against the current resolvers.
 */
async function build() {
  const checked = new Map(
    (
      await readJsonl<{ id: string; independent: Record<string, unknown> }>(
        `${DIR}fields.jsonl`
      )
    ).map((row) => [row.id, row.independent])
  );
  const rows: object[] = [];
  let excluded = 0;
  for (const row of await readJsonl<Gold>(`${DIR}gold.jsonl`)) {
    const independent = checked.get(row.id);
    if (!independent) {
      continue;
    }
    const { spans, text } = parseMarkup(row.marked);
    const resolved = resolveFields({
      now: Temporal.ZonedDateTime.from(row.now),
      spans,
      tagNames: row.tags,
      text,
    });
    const expected = {
      description: resolved.description,
      dueDate: resolved.dueDate?.toString() ?? null,
      durationMinutes: resolved.durationMinutes,
      links: resolved.links,
      recurrence: resolved.recurrence,
      startDate: resolved.startDate?.toString() ?? null,
      startTime: resolved.startTime?.toString() ?? null,
      tags: resolved.tagNames,
      title: resolved.title,
    };
    if (dateMismatches(independent, expected).length > 0) {
      excluded += 1;
      continue;
    }
    rows.push({ ...row, fields: expected });
  }
  await writeJsonl(`${ROOT}testset/test.jsonl`, rows);
  console.log(
    `${rows.length} test rows (${excluded} left out: resolver and field check disagree)`
  );
}

const STEPS: Record<string, (arg: string) => Promise<void>> = {
  build,
  compose,
  fields,
  judge,
  label: (pass) => label(pass || "A"),
};
await STEPS[step]?.(arg);
