/**
 * Test set, built independently of the training pipeline:
 *   compose   gpt-6.1-sol writes inputs from held-out tag lists and personas
 *   label A|B two blind labelling passes (neither sees the other); a pass
 *             named luna… uses the training labeller, to score it on the gold
 *   judge     a stronger pass settles span/tag disagreements
 *             (judge agreed: only record the items both passes agree on)
 *   fields    Sol computes expected task fields from the text and a
 *             reference time, without our resolver; mismatches are judged
 *   build     testset/test.jsonl for gen/evaluate.ts
 * Usage: bun gen/testset.ts <step> [arg] [concurrency=6]
 * Everything lives in data/test/.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { resolveFields } from "../../src/fields";
import { parseMarkup, toMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import { rng } from "./plan";
import { tidy } from "./validate";

const ROOT = new URL("../", import.meta.url).pathname;
const DIR = `${ROOT}data/test/`;
await mkdir(DIR, { recursive: true });
const spec = await readFile(`${ROOT}SPEC.md`, "utf8");
const [step = "compose", arg = "", concurrencyArg = "6"] =
  process.argv.slice(2);
/** Sol is rate-limited per account; a few calls at a time keep it moving. */
const CONCURRENCY = Number(concurrencyArg);
const random = rng(4242);

export interface TestInput {
  focus: string;
  id: string;
  now: string;
  tagList: string[];
  text: string;
}

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) {
    return [];
  }
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function writeJsonl(file: string, rows: unknown[]) {
  await writeFile(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

const pick = <T>(items: readonly T[]) =>
  items[Math.floor(random() * items.length)] as T;

// --- compose ---------------------------------------------------------------

/** Categories and how many 10-item calls each gets. */
const FOCUS: [string, number][] = [
  [
    "everyday: what this person would really type on an ordinary day, any mix of fields",
    50,
  ],
  [
    "voice: dictated on the go, rambling, spoken numbers and times, no punctuation",
    10,
  ],
  ["minimal: a few words, maybe one date or tag", 8],
  [
    "dense: title, description, start, deadline, duration, tag and maybe a link all in one",
    8,
  ],
  [
    "recurring: tasks that repeat, with days, times, intervals, end dates, or anchors",
    10,
  ],
  [
    "deadlines vs starts: tasks where telling 'when I'll do it' from 'when it's due' is subtle",
    8,
  ],
  [
    "tag judgment: tasks where deciding which of the user's tags apply (if any) needs care, including near-misses and confusable tag names",
    12,
  ],
  [
    "traps: words that look like dates, times, durations or tags but are part of the title (names, titles of works, product names, numbers)",
    12,
  ],
  [
    "messy: typos, abbreviations, slang, odd spacing and punctuation, emoji",
    10,
  ],
  ["links: pasted URLs or bare domains with surrounding words", 6],
  ["brain dumps: two or three sentences of context around one task", 8],
  ["power users: hashtags, compact times (3p, 1530), parentheses, prefixes", 6],
];

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
  const seeds = `${ROOT}data/seeds/`;
  const { test: tagSets } = JSON.parse(
    await readFile(`${seeds}split.json`, "utf8")
  ) as { test: string[][] };
  const personas = JSON.parse(
    await readFile(`${seeds}personas-test.json`, "utf8")
  ) as {
    description: string;
    writingHabits: string;
  }[];
  const schema = {
    additionalProperties: false,
    properties: {
      inputs: {
        items: {
          additionalProperties: false,
          properties: { item: { type: "integer" }, text: { type: "string" } },
          required: ["item", "text"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["inputs"],
    type: "object",
  };
  const calls = FOCUS.flatMap(([focus, count]) =>
    Array.from({ length: count }, () => focus)
  );
  const out = `${DIR}inputs.jsonl`;
  if (existsSync(out)) {
    console.log("inputs.jsonl exists; delete it to recompose");
    return;
  }
  const rows: TestInput[] = [];
  await pool(
    calls.map((focus, call) => async () => {
      const items = Array.from({ length: 10 }, () => ({
        persona: pick(personas),
        tagList: [...pick(tagSets)].sort(() => random() - 0.5),
      }));
      const prompt = `You write realistic test inputs for a quick-add box that turns free text into a task. Do not run any commands; answer only with the JSON object.

Each input is what one specific person would type or dictate to create ONE task. They also have a list of tags in their task manager; inputs may refer to those tags or to things a tag covers, but often don't.
Focus for this batch: ${focus}

Write one input per item, in that person's voice. Vary length, structure and vocabulary; avoid formulaic openings. Never use square brackets. The fields such a box can capture are: title, description/notes, start date/time, due date, duration, repeat schedule, links, and the person's tags.

${items.map((item, index) => `Item ${index + 1}\n  person: ${item.persona.description} ${item.persona.writingHabits}\n  their tags: ${JSON.stringify(item.tagList)}`).join("\n\n")}`;
      const result = await codexJson<{
        inputs: { item: number; text: string }[];
      }>({
        effort: "high",
        model: "gpt-6.1-sol",
        prompt,
        schema,
      });
      for (const input of result.inputs) {
        const item = items[input.item - 1];
        const text = input.text.trim();
        if (item && text && !text.includes("[") && !text.includes("]")) {
          rows.push({
            focus: focus.split(":")[0] ?? focus,
            id: `test/${call}/${input.item}`,
            now: pick(NOWS),
            tagList: item.tagList,
            text,
          });
        }
      }
    }),
    16,
    (index, result) => {
      if (result instanceof Error) {
        console.log(`compose ${index} failed: ${result.message.slice(0, 200)}`);
      }
    }
  );
  await writeJsonl(out, rows);
  console.log(`${rows.length} test inputs`);
}

// --- label -------------------------------------------------------------------

const labelSchema = {
  additionalProperties: false,
  properties: {
    items: {
      items: {
        additionalProperties: false,
        properties: {
          item: { type: "integer" },
          marked: { type: "string" },
          tags: { items: { type: "string" }, type: "array" },
        },
        required: ["item", "marked", "tags"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["items"],
  type: "object",
};

const examples = EXAMPLES.map(
  (example) =>
    `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
).join("\n\n");

function labelPrompt(items: { tagList: string[]; text: string }[]) {
  return `You label evaluation data for a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${examples}

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
  const done = new Set(
    (await readJsonl<{ id: string }>(out)).map((row) => row.id)
  );
  // Different batching per pass so context effects differ.
  const order = inputs.filter((input) => !done.has(input.id));
  const shuffle = rng(pass === "A" ? 1 : 2);
  order.sort(() => shuffle() - 0.5);
  const rows = await readJsonl<object>(out);
  const BATCH = 15;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < order.length; first += BATCH) {
    const batch = order.slice(first, first + BATCH);
    jobs.push(async () => {
      const result = await codexJson<{
        items: { item: number; marked: string; tags: string[] }[];
      }>({
        effort: "high",
        // "luna…" passes measure the training labeller against the gold.
        model: pass.startsWith("luna") ? "gpt-6-luna" : "gpt-6.1-sol",
        prompt: labelPrompt(batch),
        schema: labelSchema,
      });
      for (const entry of result.items) {
        const input = batch[entry.item - 1];
        if (!input) {
          continue;
        }
        let valid = false;
        try {
          valid = parseMarkup(entry.marked).text === input.text;
        } catch {
          valid = false;
        }
        rows.push({
          id: input.id,
          marked: entry.marked,
          tags: entry.tags,
          valid,
        });
      }
      await writeJsonl(out, rows);
    });
  }
  await pool(jobs, CONCURRENCY, (index, result) => {
    if (result instanceof Error) {
      console.log(
        `label ${pass} ${index} failed: ${result.message.slice(0, 200)}`
      );
    }
  });
  console.log(`pass ${pass}: ${rows.length} labels`);
}

switch (step) {
  case "compose":
    await compose();
    break;
  case "label":
    await label(arg || "A");
    break;
  default:
    break;
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
  const inputs = new Map(
    (await readJsonl<TestInput>(`${DIR}inputs.jsonl`)).map((input) => [
      input.id,
      input,
    ])
  );
  const a = new Map(
    (await readJsonl<Label>(`${DIR}labels-A.jsonl`)).map((row) => [row.id, row])
  );
  const b = new Map(
    (await readJsonl<Label>(`${DIR}labels-B.jsonl`)).map((row) => [row.id, row])
  );
  const out = `${DIR}gold.jsonl`;
  const done = new Set(
    (await readJsonl<{ id: string }>(out)).map((row) => row.id)
  );
  const gold: object[] = await readJsonl(out);
  const disputes: { a: Label; b: Label; input: TestInput }[] = [];
  let agreed = 0;
  for (const [id, input] of inputs) {
    const first = a.get(id);
    const second = b.get(id);
    if (done.has(id) || !(first?.valid && second?.valid)) {
      continue;
    }
    const tagList = new Set(input.tagList);
    first.tags = first.tags.filter((tag) => tagList.has(tag));
    second.tags = second.tags.filter((tag) => tagList.has(tag));
    if (
      canonical(first.marked) === canonical(second.marked) &&
      sameTags(first.tags, second.tags)
    ) {
      gold.push({
        ...input,
        agreement: "both",
        marked: canonical(first.marked),
        tags: first.tags,
      });
      agreed += 1;
    } else {
      disputes.push({ a: first, b: second, input });
    }
  }
  console.log(`${agreed} agreed, ${disputes.length} disputed`);
  await writeJsonl(out, gold);
  if (arg === "agreed") {
    return;
  }
  const schema = {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            item: { type: "integer" },
            marked: { type: "string" },
            reason: { type: "string" },
            tags: { items: { type: "string" }, type: "array" },
          },
          required: ["item", "marked", "tags", "reason"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  };
  const BATCH = 8;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < disputes.length; first += BATCH) {
    const batch = disputes.slice(first, first + BATCH);
    jobs.push(async () => {
      const prompt = `You are the final judge for evaluation labels of a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${examples}

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
      }>({
        effort: "xhigh",
        model: "gpt-6.1-sol",
        prompt,
        schema,
      });
      for (const entry of result.items) {
        const dispute = batch[entry.item - 1];
        if (!dispute) {
          continue;
        }
        try {
          if (parseMarkup(entry.marked).text !== dispute.input.text) {
            continue;
          }
        } catch {
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
  await pool(jobs, CONCURRENCY, (index, result) => {
    if (result instanceof Error) {
      console.log(`judge ${index} failed: ${result.message.slice(0, 200)}`);
    }
  });
  console.log(`${gold.length} gold`);
}

// --- fields ------------------------------------------------------------------

interface Gold extends TestInput {
  marked: string;
  tags: string[];
}

function fieldsOf(resolved: Awaited<ReturnType<typeof resolveFields>>) {
  return {
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
}

const DATE_FIELDS = [
  "startDate",
  "startTime",
  "dueDate",
  "durationMinutes",
  "recurrence",
] as const;

async function fields() {
  const gold = await readJsonl<Gold>(`${DIR}gold.jsonl`);
  const out = `${DIR}fields.jsonl`;
  const done = new Map(
    (await readJsonl<{ id: string }>(out)).map((row) => [row.id, row])
  );
  const todo = gold.filter((row) => !done.has(row.id));
  const schema = {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            dueDate: { type: ["string", "null"] },
            durationMinutes: { type: ["integer", "null"] },
            item: { type: "integer" },
            recurrence: {
              anyOf: [
                { type: "null" },
                {
                  additionalProperties: false,
                  properties: {
                    byDay: {
                      items: {
                        enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
                        type: "string",
                      },
                      type: ["array", "null"],
                    },
                    byMonthDay: { type: ["integer", "null"] },
                    count: { type: ["integer", "null"] },
                    freq: {
                      enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
                      type: "string",
                    },
                    interval: { type: "integer" },
                    until: { type: ["string", "null"] },
                  },
                  required: [
                    "freq",
                    "interval",
                    "byDay",
                    "byMonthDay",
                    "count",
                    "until",
                  ],
                  type: "object",
                },
              ],
            },
            startDate: { type: ["string", "null"] },
            startTime: { type: ["string", "null"] },
          },
          required: [
            "item",
            "startDate",
            "startTime",
            "dueDate",
            "durationMinutes",
            "recurrence",
          ],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  };
  const rows: object[] = [...done.values()];
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
        schema,
      });
      for (const entry of result.items) {
        const row = batch[entry.item - 1];
        if (!row) {
          continue;
        }
        const { spans } = parseMarkup(row.marked);
        const resolved = fieldsOf(
          await resolveFields({
            now: Temporal.ZonedDateTime.from(row.now),
            spans,
            tagNames: row.tags,
          })
        );
        const recurrence = entry.recurrence
          ? Object.fromEntries(
              Object.entries(entry.recurrence as object).filter(
                ([, value]) => value !== null
              )
            )
          : null;
        const independent: Record<string, unknown> = { ...entry, recurrence };
        const mismatches = DATE_FIELDS.filter(
          (field) =>
            JSON.stringify(sortKeys(independent[field] ?? null)) !==
            JSON.stringify(sortKeys(resolved[field] ?? null))
        );
        rows.push({ id: row.id, independent, mismatches, resolved });
      }
      await writeJsonl(out, rows);
    });
  }
  await pool(jobs, CONCURRENCY, (index, result) => {
    if (result instanceof Error) {
      console.log(`fields ${index} failed: ${result.message.slice(0, 200)}`);
    }
  });
  const all = rows as { mismatches: string[] }[];
  console.log(
    `${all.length} computed; ${all.filter((row) => row.mismatches.length > 0).length} disagree with the resolver`
  );
}

// --- build -------------------------------------------------------------------

/**
 * testset/test.jsonl for gen/evaluate.ts: gold labels with the fields our
 * resolvers give for them, so the set measures the model. Where the
 * independent field check (fields) disagreed, the item is left out until
 * that is settled.
 */
async function build() {
  const checked = new Map(
    (
      await readJsonl<{ id: string; mismatches: string[] }>(
        `${DIR}fields.jsonl`
      )
    ).map((row) => [row.id, row])
  );
  const rows: object[] = [];
  for (const row of await readJsonl<Gold>(`${DIR}gold.jsonl`)) {
    if ((checked.get(row.id)?.mismatches.length ?? 0) > 0) {
      continue;
    }
    const { spans, text } = parseMarkup(row.marked);
    const resolved = fieldsOf(
      await resolveFields({
        now: Temporal.ZonedDateTime.from(row.now),
        spans,
        tagNames: row.tags,
        text,
      })
    );
    rows.push({ ...row, fields: resolved });
  }
  await writeJsonl(`${ROOT}testset/test.jsonl`, rows);
  console.log(`${rows.length} test rows (${checked.size} field-checked)`);
}

function sortKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([x], [y]) => x.localeCompare(y))
      )
    : value;
}

switch (step) {
  case "judge":
    await judge();
    break;
  case "fields":
    await fields();
    break;
  case "build":
    await build();
    break;
  default:
    break;
}
