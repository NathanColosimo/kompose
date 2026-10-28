/**
 * Date benchmark: how well spans turn into dates, apart from the model.
 *   write     gpt-6-luna writes short labelled tasks whose S/U/R/M spans
 *             cover one category of date phrasing each
 *   answer A|B  two blind gpt-6.1-sol passes compute the expected fields
 *   build     testset/dates.jsonl: items both passes agree on
 *   score     resolve every item's spans and report per category
 * Usage: bun gen/datebench.ts <step> [arg] [concurrency=8]
 * Everything lives in data/dates/.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { resolveFields } from "../../src/fields";
import { parseMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { rng } from "./plan";

const ROOT = new URL("../", import.meta.url).pathname;
const DIR = `${ROOT}data/dates/`;
const BENCH = `${ROOT}testset/dates.jsonl`;
await mkdir(DIR, { recursive: true });
const [step = "score", arg = "", concurrencyArg = "8"] = process.argv.slice(2);
const CONCURRENCY = Number(concurrencyArg);
const random = rng(777);

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

export const CATEGORIES: Record<string, string> = {
  absolute:
    "absolute dates in many written formats: 'nov 3', '3rd of november', '11/3', '3/11' only where unambiguous, '2026-11-03', 'the 15th', 'Dec 1st at noon', 'Mon Nov 9', 'jan 2 2027', 'sept. 30'",
  clock:
    "times of day written many ways: 'half past 3', 'quarter to 5', 'noonish', '3p', '1530', '15:30h', '7ish', 'at 9 sharp', 'midnight', '0800', '4.30pm', '10 30', 'eleven am', with or without a day",
  deadlines:
    "deadlines (U spans, after cue words like 'by', 'due', 'before', 'no later than' which stay outside the span): 'by [U:friday]', 'due [U:eom]', 'before [U:5pm tmrw]', 'no later than [U:the 3rd]', 'deadline [U:next wed]', sometimes alongside a start",
  holidays:
    "holidays and named days: christmas eve, thanksgiving, new year's day, mother's day, halloween, valentine's, july 4th, labor day, boxing day, easter, memorial day, with or without a time",
  languages:
    "dates in Spanish, French, German, Italian, Portuguese or Japanese inside English tasks, or mixed: 'mañana a las 5', 'demain 14h', 'morgen um 3', 'domani alle 4', 'amanhã às 10', '明日 15時', 'el viernes', 'lundi prochain'",
  offsets:
    "relative offsets: 'in 2 wks', 'a week from friday', 'in 90 min', 'in an hour', 'in a fortnight', 'in 3 days', 'day after tomorrow', '2 days from now', 'in half an hour', 'next month', 'in 6 months'",
  periods:
    "period words: 'end of month', 'eow', 'eod', 'cob', 'this weekend', 'next week', 'early next week', 'mid-december', 'end of Q1', 'beginning of next month', 'later this week', 'tonight', 'this afternoon', 'first thing tomorrow'",
  ranges:
    "time ranges and start times with an end: '2-3pm', '10 to 11:30', 'from 9 till noon', '9-5 tomorrow', 'thu 1:30–2:15', '7-9pm sat', 'tomorrow 11am to 1pm', sometimes with a separate M duration",
  relative:
    "everyday relative days and weekdays, often with times: 'tmrw 3', 'fri at 4:30', 'next tue morning', 'this thursday', 'sat am', 'monday evening', 'tomorrow night', 'today at 6', 'wed noon'",
  repeats:
    "repeats (R spans, with an optional S start and U deadline as separate spans): 'every weekday at 9', 'every other mon', '1st of every month', 'every 3 days', 'mon wed fri 7am', 'biweekly', 'monthly on the 15th', 'every year on mar 3', 'every tue until dec', 'every day for 2 weeks', 'every sun starting [S:next week]', '[R:every month] by [U:the 1st]'",
  typos:
    "typos, shorthand and texting style in the date: 'tmrow', 'wedensday', 'thur', 'nxt fri', '2moro', 'tdy', 'tues @ 3', 'thrus 10a', 'satuday', 'fri nite', 'mon morn', '2nite'",
  zones:
    "times with a time zone or city: '3pm PT', '9am EST', '14:00 CET', 'noon ET tomorrow', '10am london time' only with a zone abbreviation, '8:30 PST fri'",
};

const ZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "America/Denver",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Asia/Kolkata",
  "America/Sao_Paulo",
];

/** A reference moment: any day 2026-10..2027-12, often at awkward hours. */
function randomNow() {
  const day = Temporal.PlainDate.from("2026-10-01").add({
    days: Math.floor(random() * 455),
  });
  const hour = pick([
    0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  ]);
  const minute = pick([0, 5, 15, 30, 45, 50]);
  return day
    .toPlainDateTime({ hour, minute })
    .toZonedDateTime(pick(ZONES))
    .toString();
}

interface Written {
  category: string;
  id: string;
  marked: string;
  now: string;
}

async function write() {
  const out = `${DIR}written.jsonl`;
  const rows = await readJsonl<Written>(out);
  const perCategory = Number(arg || 8);
  const schema = {
    additionalProperties: false,
    properties: {
      items: { items: { type: "string" }, type: "array" },
    },
    required: ["items"],
    type: "object",
  };
  const jobs: (() => Promise<void>)[] = [];
  for (const [category, guidance] of Object.entries(CATEGORIES)) {
    for (let call = 0; call < perCategory; call += 1) {
      const id = `${category}/${call}`;
      if (rows.some((row) => row.id.startsWith(`${id}/`))) {
        continue;
      }
      jobs.push(async () => {
        const prompt = `Write 30 short to-do inputs as people type them into a task app's quick-add box, each labelled with inline markup. Do not run any commands; answer only with the JSON object.

Focus for this batch: ${guidance}.

Markup: [T:...] the task title, [S:...] when it starts or happens (one-off), [U:...] the deadline, [R:...] a repeat schedule, [M:...] a duration. Leave cue words outside spans ("on [S:friday]", "at [S:4]", "by [U:monday]", "starting [S:next week]", "for [M:30 min]"); a time zone after a time belongs inside the span ("[S:3pm ET]"). Removing the markup must give the exact text. Every item has a T and at least one S, U or R span, and nothing else labelled. Vary the tasks (work, home, errands, health, school, hobbies), the casing, and how much is written; mostly realistic phrasing, with some harder or unusual ones. No two items alike. Batch ${call + 1} of ${perCategory}: avoid the most obvious examples.

Example: [T:call the dentist] [S:tmrw at 4]`;
        const result = await codexJson<{ items: string[] }>({
          model: "gpt-6-luna",
          prompt,
          schema,
        });
        result.items.forEach((marked, index) => {
          try {
            parseMarkup(marked);
          } catch {
            return;
          }
          rows.push({
            category,
            id: `${id}/${index}`,
            marked,
            now: randomNow(),
          });
        });
        await writeJsonl(out, rows);
      });
    }
  }
  await pool(jobs, CONCURRENCY, (index, result) => {
    if (result instanceof Error) {
      console.log(`write ${index} failed: ${result.message.slice(0, 200)}`);
    }
  });
  console.log(`${rows.length} items`);
}

const RECURRENCE_SCHEMA = {
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
      required: ["freq", "interval", "byDay", "byMonthDay", "count", "until"],
      type: "object",
    },
  ],
};

export const DATE_FIELDS = [
  "startDate",
  "startTime",
  "dueDate",
  "durationMinutes",
  "recurrence",
] as const;

export const CONVENTIONS = `Conventions: a bare weekday means the next one on or after today (today itself if it's that weekday); "next <weekday>" means the coming one, not the week after; "this <weekday>" likewise; bare hours 1-7 without am/pm are pm, 8-11 am, 12 is noon; day parts: morning 09:00, afternoon 13:00, evening 18:00, night/tonight 20:00; "first thing" 09:00; "in N days/weeks/months" keeps no time of day, "in N hours/minutes" does (now plus the offset); "next week" is next Monday, "this weekend" Saturday, "next month" the 1st of next month, end of week = Sunday, end of month = its last day; eod/cob = today with no time; a date with no year that has already passed this year rolls to next year; a time already past today with no day named means tomorrow at that time. A time with a time zone is converted to the user's zone (now's zone). A phrase in another language means what it says. A phrase that names no concrete date gives null.`;

async function answer(pass: string) {
  const items = await readJsonl<Written>(`${DIR}written.jsonl`);
  const out = `${DIR}answers-${pass}.jsonl`;
  const done = new Map(
    (await readJsonl<{ id: string }>(out)).map((row) => [row.id, row])
  );
  // Each pass sees its own order and batches, so they share no context.
  const order = [...items.filter((item) => !done.has(item.id))];
  const shuffle = rng(pass === "A" ? 1 : 2);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(shuffle() * (i + 1));
    [order[i], order[j]] = [order[j] as Written, order[i] as Written];
  }
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
            recurrence: RECURRENCE_SCHEMA,
            startDate: { type: ["string", "null"] },
            startTime: { type: ["string", "null"] },
          },
          required: ["item", ...DATE_FIELDS],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  };
  const rows: object[] = [...done.values()];
  const BATCH = 20;
  const jobs: (() => Promise<void>)[] = [];
  for (let first = 0; first < order.length; first += BATCH) {
    const batch = order.slice(first, first + BATCH);
    jobs.push(async () => {
      const prompt = `You compute the expected date fields of to-do items for an evaluation set. Do not run any commands; answer only with the JSON object. Work each one out carefully with a calendar.

Each item is a labelled quick-add text and the moment it was typed ("now", with its time zone and weekday). From the S (start), U (due), R (repeat) and M (duration) spans, work out:
- startDate (YYYY-MM-DD) and startTime (HH:MM:SS, or null when no time of day was given)
- dueDate (YYYY-MM-DD; deadlines have no time field)
- durationMinutes (integer; from M, or from an explicit clock range in S like "2-2:30" when there is no M; otherwise null)
- recurrence in this schema, or null: {freq: DAILY|WEEKLY|MONTHLY|YEARLY, interval, byDay (WEEKLY only: weekday codes), byMonthDay (MONTHLY only: one day 1-31), count, until (YYYY-MM-DD)}; unused keys null. "every weekday" is WEEKLY MO-FR; "biweekly" every 2 weeks. If the repeat can't be expressed (e.g. "first monday of each month", hourly), recurrence is null but startDate is still its first occurrence. A repeating task's startDate is its first occurrence on or after now (or on or after an S "starting ..." date) and startTime its time. A U inside a repeat ("every month by the 1st") is the first such deadline.
${CONVENTIONS}

## Items

${batch
  .map(
    (row, index) =>
      `Item ${index + 1}\n  now: ${row.now} (${Temporal.ZonedDateTime.from(row.now).toLocaleString("en-US", { weekday: "long" })})\n  labelled: ${row.marked}`
  )
  .join("\n\n")}`;
      const result = await codexJson<{
        items: (Record<string, unknown> & { item: number })[];
      }>({ effort: "high", model: "gpt-6.1-sol", prompt, schema });
      for (const entry of result.items) {
        const row = batch[entry.item - 1];
        if (row) {
          const { item: _, ...fields } = entry;
          rows.push({ fields: compact(fields), id: row.id });
        }
      }
      await writeJsonl(out, rows);
    });
  }
  await pool(jobs, CONCURRENCY, (index, result) => {
    if (result instanceof Error) {
      console.log(`answer ${index} failed: ${result.message.slice(0, 200)}`);
    }
  });
  console.log(`${rows.length} answered`);
}

/** Recurrence without null keys, as the resolver writes it. */
function compact(fields: Record<string, unknown>) {
  const recurrence = fields.recurrence
    ? Object.fromEntries(
        Object.entries(fields.recurrence as object).filter(
          ([, value]) => value !== null
        )
      )
    : null;
  return { ...fields, recurrence };
}

function sortKeys(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      )
    : value;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));

const CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/**
 * A recurrence as the task schema stores it: a weekly repeat without days
 * runs on the start's weekday, a monthly one on the start's day.
 */
function canonical(recurrence: unknown, startDate: unknown) {
  if (
    !(
      recurrence &&
      typeof recurrence === "object" &&
      typeof startDate === "string"
    )
  ) {
    return recurrence ?? null;
  }
  const rule = { ...(recurrence as Record<string, unknown>) };
  const start = Temporal.PlainDate.from(startDate);
  if (rule.freq === "WEEKLY" && !rule.byDay) {
    rule.byDay = [CODES[start.dayOfWeek - 1]];
  }
  if (rule.freq === "MONTHLY" && !rule.byMonthDay) {
    rule.byMonthDay = start.day;
  }
  if (Array.isArray(rule.byDay)) {
    rule.byDay = [...rule.byDay].sort(
      (a, b) => CODES.indexOf(a) - CODES.indexOf(b)
    );
  }
  return rule;
}

async function build() {
  const items = await readJsonl<Written>(`${DIR}written.jsonl`);
  const answers = (pass: string) =>
    readJsonl<{ fields: Record<string, unknown>; id: string }>(
      `${DIR}answers-${pass}.jsonl`
    ).then((answered) => new Map(answered.map((row) => [row.id, row.fields])));
  const [a, b] = await Promise.all([answers("A"), answers("B")]);
  const rows: object[] = [];
  let disagree = 0;
  for (const item of items) {
    const x = a.get(item.id);
    const y = b.get(item.id);
    if (!(x && y)) {
      continue;
    }
    if (DATE_FIELDS.every((field) => same(x[field], y[field]))) {
      rows.push({ ...item, expect: x });
    } else {
      disagree += 1;
    }
  }
  await writeJsonl(BENCH, rows);
  console.log(`${rows.length} agreed, ${disagree} disagreed`);
}

interface BenchRow extends Written {
  expect: Record<string, unknown>;
}

async function score() {
  const rows = await readJsonl<BenchRow>(BENCH);
  const show = Number(arg || 20);
  const byCategory: Record<string, { n: number; right: number }> = {};
  const wrongFields: Record<string, number> = {};
  const failures: string[] = [];
  let elapsed = 0;
  for (const row of rows) {
    const { spans, text } = parseMarkup(row.marked);
    const started = performance.now();
    const resolved = resolveFields({
      now: Temporal.ZonedDateTime.from(row.now),
      spans,
      tagNames: [],
      text,
    });
    elapsed += performance.now() - started;
    const actual: Record<string, unknown> = {
      dueDate: resolved.dueDate?.toString() ?? null,
      durationMinutes: resolved.durationMinutes,
      recurrence: resolved.recurrence,
      startDate: resolved.startDate?.toString() ?? null,
      startTime: resolved.startTime?.toString() ?? null,
    };
    const wrong = DATE_FIELDS.filter((field) =>
      field === "recurrence"
        ? !same(
            canonical(row.expect.recurrence, row.expect.startDate),
            canonical(actual.recurrence, actual.startDate)
          )
        : !same(row.expect[field], actual[field])
    );
    let stats = byCategory[row.category];
    if (!stats) {
      stats = { n: 0, right: 0 };
      byCategory[row.category] = stats;
    }
    stats.n += 1;
    if (wrong.length === 0) {
      stats.right += 1;
      continue;
    }
    for (const field of wrong) {
      wrongFields[field] = (wrongFields[field] ?? 0) + 1;
    }
    if (failures.length < show) {
      failures.push(
        `${row.id} now=${row.now}\n  ${row.marked}\n${wrong
          .map(
            (field) =>
              `  ${field}: expected ${JSON.stringify(row.expect[field])} got ${JSON.stringify(actual[field])}`
          )
          .join("\n")}`
      );
    }
  }
  const total = Object.values(byCategory).reduce(
    (sum, stats) => ({ n: sum.n + stats.n, right: sum.right + stats.right }),
    { n: 0, right: 0 }
  );
  const pct = (stats: { n: number; right: number }) =>
    `${((100 * stats.right) / stats.n).toFixed(1)}%`;
  console.log(
    `dates: ${total.n} items, ${pct(total)} all right, ${(elapsed / total.n).toFixed(2)} ms/item`
  );
  console.log(
    Object.entries(byCategory)
      .sort()
      .map(([category, stats]) => `${category} ${pct(stats)} (${stats.n})`)
      .join(" | ")
  );
  console.log("wrong fields", wrongFields);
  console.log(failures.join("\n"));
}

switch (step) {
  case "write":
    await write();
    break;
  case "answer":
    await answer(arg || "A");
    break;
  case "build":
    await build();
    break;
  default:
    await score();
}
