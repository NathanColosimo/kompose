/**
 * End-to-end evaluation of an exported model through the TypeScript parser.
 * Usage: bun gen/evaluate.ts <run dir> [handwritten|holidays|test|both]
 * Prints per-field accuracy and the first failures.
 */
import { readFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { createTaskParser } from "../../src/parser";
import { plainFields, ROOT, readJsonl, sortKeys } from "./common";

const [run = "", which = "both"] = process.argv.slice(2);
const SHOW = Number(process.env.SHOW ?? 15);

type Actual = ReturnType<typeof plainFields>;
/** Fields left out are expected empty. */
type Expected = Partial<Actual> & { title: string };

interface Case {
  expect: Expected;
  id: string;
  now: string;
  tags: string[];
  text: string;
}

const FIELDS = [
  "title",
  "description",
  "startDate",
  "startTime",
  "dueDate",
  "durationMinutes",
  "recurrence",
  "links",
  "tags",
] as const;
type Field = (typeof FIELDS)[number];

const PUNCTUATION = /[^\p{L}\p{N}]+/gu;

/** Titles and descriptions compare by their words: punctuation and case are style. */
function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(PUNCTUATION, " ").trim().toLowerCase();
}

const EDGE_WORDS = new Set([
  "a",
  "and",
  "at",
  "by",
  "for",
  "in",
  "my",
  "on",
  "or",
  "please",
  "pls",
  "the",
  "to",
]);

/** Words of a title or description without filler at either end. */
function coreWords(value: string | null | undefined) {
  const words = normalizeText(value).split(" ").filter(Boolean);
  while (words.length > 0 && EDGE_WORDS.has(words[0] as string)) {
    words.shift();
  }
  while (words.length > 0 && EDGE_WORDS.has(words.at(-1) as string)) {
    words.pop();
  }
  return words;
}

/**
 * Close enough to use as-is: the same words up to filler at the edges, or
 * 80%+ word overlap (a stray "when home" or "before the meeting").
 */
function closeEnough(
  expected: string | null | undefined,
  actual: string | null
) {
  const a = coreWords(expected);
  const b = coreWords(actual);
  if (a.join(" ") === b.join(" ")) {
    return true;
  }
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  const remaining = [...b];
  let shared = 0;
  for (const word of a) {
    const index = remaining.indexOf(word);
    if (index >= 0) {
      shared += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * shared) / (a.length + b.length) >= 0.8;
}

function equal(field: Field, expected: Expected, actual: Actual) {
  switch (field) {
    case "title":
    case "description":
      return normalizeText(expected[field]) === normalizeText(actual[field]);
    case "tags":
    case "links":
      return (
        JSON.stringify([...(expected[field] ?? [])].sort()) ===
        JSON.stringify([...actual[field]].sort())
      );
    case "recurrence":
      return (
        JSON.stringify(sortKeys(expected.recurrence ?? null)) ===
        JSON.stringify(sortKeys(actual.recurrence ?? null))
      );
    default:
      return (expected[field] ?? null) === (actual[field] ?? null);
  }
}

/** Sets in testset/<name>.json: cases written by hand at one `now`. */
const HAND_SETS = ["handwritten", "holidays"];

async function loadCases(): Promise<Record<string, Case[]>> {
  const sets: Record<string, Case[]> = {};
  for (const name of HAND_SETS) {
    if (which !== name && which !== "both") {
      continue;
    }
    const hand = JSON.parse(
      await readFile(`${ROOT}testset/${name}.json`, "utf8")
    ) as {
      cases: { expect: Expected; tags?: string[]; text: string }[];
      defaultTags: string[];
      now: string;
    };
    sets[name] = hand.cases.map((c, index) => ({
      expect: c.expect,
      id: `${name}/${index}`,
      now: hand.now,
      tags: c.tags ?? hand.defaultTags,
      text: c.text,
    }));
  }
  if (which === "test" || which === "both") {
    const rows = await readJsonl<{
      fields: Expected;
      focus: string;
      id: string;
      now: string;
      tagList: string[];
      text: string;
    }>(`${ROOT}testset/test.jsonl`);
    for (const row of rows) {
      const c = { ...row, expect: row.fields, tags: row.tagList };
      for (const key of ["test", `test:${row.focus}`]) {
        sets[key] = [...(sets[key] ?? []), c];
      }
    }
  }
  return sets;
}

const parse = createTaskParser(
  new Uint8Array(await readFile(`${run}/task-parser.bin`)).buffer
);
for (const [name, cases] of Object.entries(await loadCases())) {
  const correct = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<
    Field,
    number
  >;
  let all = 0;
  let usable = 0;
  const failures: string[] = [];
  let elapsed = 0;
  for (const c of cases) {
    const started = performance.now();
    const parsed = parse(c.text, {
      now: Temporal.ZonedDateTime.from(c.now),
      tags: c.tags.map((tagName) => ({ id: tagName, name: tagName })),
    });
    elapsed += performance.now() - started;
    const actual = plainFields(
      parsed,
      parsed.tags.map((tag) => tag.name)
    );
    const wrong = FIELDS.filter((field) => !equal(field, c.expect, actual));
    for (const field of FIELDS) {
      if (!wrong.includes(field)) {
        correct[field] += 1;
      }
    }
    // Usable: every wrong field is a title or description that is close enough.
    if (
      wrong.every(
        (field) =>
          (field === "title" || field === "description") &&
          closeEnough(c.expect[field], actual[field])
      )
    ) {
      usable += 1;
    }
    if (wrong.length === 0) {
      all += 1;
    } else if (failures.length < SHOW) {
      const spans = parsed.spans
        .map((span) => `[${span.label}:${span.text}]`)
        .join(" ");
      failures.push(
        `${c.id} ${JSON.stringify(c.text)} tags=${JSON.stringify(c.tags)}\n  spans: ${spans}\n` +
          wrong
            .map(
              (field) =>
                `  ${field}: expected ${JSON.stringify(c.expect[field] ?? null)} got ${JSON.stringify(actual[field])}`
            )
            .join("\n")
      );
    }
  }
  const pct = (n: number) => `${((100 * n) / cases.length).toFixed(1)}%`;
  console.log(
    `\n== ${name}: ${cases.length} cases, all fields right ${pct(all)}, usable ${pct(usable)}, ${(elapsed / cases.length).toFixed(1)} ms/case`
  );
  console.log(
    FIELDS.map((field) => `${field} ${pct(correct[field])}`).join(" | ")
  );
  if (HAND_SETS.includes(name) || name === "test") {
    console.log(failures.join("\n"));
  }
}
