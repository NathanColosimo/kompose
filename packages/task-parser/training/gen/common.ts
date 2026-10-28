/** Helpers shared by the gen scripts. */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import type { TaskFields } from "../../src/fields";
import { parseMarkup } from "../../src/spans";
import { codexJson } from "./codex";

/** The training/ directory. */
export const ROOT = new URL("../", import.meta.url).pathname;

/** Mulberry32: small seeded PRNG so plans are reproducible. */
export function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]) {
  return items[Math.floor(random() * items.length)] as T;
}

export function shuffled<T>(random: () => number, items: readonly T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

/** `items` in consecutive groups of `size`. */
export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );
}

/** Rows of a JSONL file; none if it doesn't exist yet. */
export async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) {
    return [];
  }
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl(file: string, rows: unknown[]) {
  await writeFile(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

export interface Persona {
  description: string;
  writingHabits: string;
}

/** Tag lists and personas from gen/seeds.ts, as gen/split.ts divided them. */
export async function readSeeds(split: "test" | "train") {
  const seeds = `${ROOT}data/seeds/`;
  const tagSets = JSON.parse(await readFile(`${seeds}split.json`, "utf8"))[
    split
  ] as string[][];
  const personas = JSON.parse(
    await readFile(
      `${seeds}${split === "test" ? "personas-test" : "personas"}.json`,
      "utf8"
    )
  ) as Persona[];
  return { personas, tagSets };
}

/** A Codex answer schema: `{items: [{item, ...properties}]}`, all required. */
export function itemsSchema(properties: Record<string, object>) {
  return {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: { item: { type: "integer" }, ...properties },
          required: ["item", ...Object.keys(properties)],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  };
}

/** Whether `marked` is valid markup of exactly `text`. */
export function isMarkupOf(marked: string, text: string) {
  try {
    return parseMarkup(marked).text === text;
  } catch {
    return false;
  }
}

export const LABELS_SCHEMA = itemsSchema({
  marked: { type: "string" },
  tags: { items: { type: "string" }, type: "array" },
});

// --- inputs written like real quick-add text (test set and gen/solwrite.ts)

/** Categories of input and how many 10-item calls each gets. */
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

/** One focus per call, each repeated by its weight. */
export const FOCUS_CALLS = FOCUS.flatMap(([focus, count]) =>
  Array.from({ length: count }, () => focus)
);

const BRACKET = /[[\]]/;

/** gpt-6.1-sol writes one input per item in that person's voice. */
export async function writeInputs(
  focus: string,
  items: { persona: Persona; tagList: string[] }[]
) {
  const prompt = `You write realistic inputs for a quick-add box that turns free text into a task. Do not run any commands; answer only with the JSON object.

Each input is what one specific person would type or dictate to create ONE task. They also have a list of tags in their task manager; inputs may refer to those tags or to things a tag covers, but often don't.
Focus for this batch: ${focus}

Write one input per item, in that person's voice. Vary length, structure and vocabulary; avoid formulaic openings. Never use square brackets. The fields such a box can capture are: title, description/notes, start date/time, due date, duration, repeat schedule, links, and the person's tags.

${items.map((item, index) => `Item ${index + 1}\n  person: ${item.persona.description} ${item.persona.writingHabits}\n  their tags: ${JSON.stringify(item.tagList)}`).join("\n\n")}`;
  const result = await codexJson<{ items: { item: number; text: string }[] }>({
    effort: "high",
    model: "gpt-6.1-sol",
    prompt,
    schema: itemsSchema({ text: { type: "string" } }),
  });
  return result.items.flatMap(({ item, text }) => {
    const trimmed = text.trim();
    return items[item - 1] && trimmed && !BRACKET.test(trimmed)
      ? [{ item, text: trimmed }]
      : [];
  });
}

// --- expected date fields (test set and date benchmark) -------------------

/** Resolved task fields as JSON, with tag names. */
export function plainFields(fields: TaskFields) {
  return {
    description: fields.description,
    dueDate: fields.dueDate?.toString() ?? null,
    durationMinutes: fields.durationMinutes,
    links: fields.links,
    recurrence: fields.recurrence,
    startDate: fields.startDate?.toString() ?? null,
    startTime: fields.startTime?.toString() ?? null,
    tags: fields.tagNames,
    title: fields.title,
  };
}

/** Labelled items and when each was typed, as the field prompts list them. */
export function datedItems(rows: { marked: string; now: string }[]) {
  return rows
    .map(
      (row, index) =>
        `Item ${index + 1}\n  now: ${row.now} (${Temporal.ZonedDateTime.from(row.now).toLocaleString("en-US", { weekday: "long" })})\n  labelled: ${row.marked}`
    )
    .join("\n\n");
}

export const DATE_FIELDS = [
  "startDate",
  "startTime",
  "dueDate",
  "durationMinutes",
  "recurrence",
] as const;

/** The date fields of a Codex answer, in the task schema's recurrence. */
export const DATE_FIELDS_SCHEMA = itemsSchema({
  dueDate: { type: ["string", "null"] },
  durationMinutes: { type: ["integer", "null"] },
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
        required: ["freq", "interval", "byDay", "byMonthDay", "count", "until"],
        type: "object",
      },
    ],
  },
  startDate: { type: ["string", "null"] },
  startTime: { type: ["string", "null"] },
});

/** Codex's answer for one item, with null recurrence keys dropped as the resolver does. */
export function answeredFields({
  item: _,
  ...fields
}: Record<string, unknown> & { item: number }) {
  return { ...fields, recurrence: withoutNulls(fields.recurrence) };
}

function withoutNulls(value: unknown) {
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== null)
      )
    : null;
}

export function sortKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      )
    : value;
}

const CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * A recurrence as the task schema stores it: a weekly repeat without days
 * runs on the start's weekday, a monthly one on the start's day.
 */
function canonicalRecurrence(recurrence: unknown, startDate: unknown) {
  const rule = withoutNulls(recurrence);
  if (!rule) {
    return null;
  }
  if (typeof startDate === "string") {
    const start = Temporal.PlainDate.from(startDate);
    if (rule.freq === "WEEKLY" && !rule.byDay) {
      rule.byDay = [CODES[start.dayOfWeek - 1]];
    }
    if (rule.freq === "MONTHLY" && !rule.byMonthDay) {
      rule.byMonthDay = start.day;
    }
  }
  if (Array.isArray(rule.byDay)) {
    rule.byDay = [...rule.byDay].sort(
      (a, b) => CODES.indexOf(a) - CODES.indexOf(b)
    );
  }
  return sortKeys(rule);
}

/** The date fields where `a` and `b` differ. */
export function dateMismatches(
  a: Record<string, unknown>,
  b: Record<string, unknown>
) {
  return DATE_FIELDS.filter((field) =>
    field === "recurrence"
      ? JSON.stringify(canonicalRecurrence(a.recurrence, a.startDate)) !==
        JSON.stringify(canonicalRecurrence(b.recurrence, b.startDate))
      : JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null)
  );
}
