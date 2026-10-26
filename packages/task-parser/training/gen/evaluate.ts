/**
 * End-to-end evaluation of an exported model through the TypeScript parser.
 * Usage: bun gen/evaluate.ts <run dir> [handwritten|test|both] [--show N]
 * Prints per-field accuracy and the first failures.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { createTaskParser, type ParsedTask } from "../../src/parser";

const ROOT = new URL("../", import.meta.url).pathname;
const [run = "", which = "both"] = process.argv.slice(2);
const showIndex = process.argv.indexOf("--show");
const show = showIndex > 0 ? Number(process.argv[showIndex + 1]) : 15;

export interface Expected {
  description?: string | null;
  dueDate?: string | null;
  durationMinutes?: number | null;
  links?: string[];
  recurrence?: object | null;
  startDate?: string | null;
  startTime?: string | null;
  tags?: string[];
  title: string;
}

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

const PUNCTUATION = /[^\p{L}\p{N}]+/gu;

/** Titles and descriptions compare by their words: punctuation and case are style. */
function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(PUNCTUATION, " ").trim().toLowerCase();
}

function actualOf(parsed: ParsedTask) {
  return {
    description: parsed.description,
    dueDate: parsed.dueDate?.toString() ?? null,
    durationMinutes: parsed.durationMinutes,
    links: parsed.links,
    recurrence: parsed.recurrence,
    startDate: parsed.startDate?.toString() ?? null,
    startTime: parsed.startTime?.toString() ?? null,
    tags: parsed.tags.map((tag) => tag.name),
    title: parsed.title,
  };
}

function equal(
  field: (typeof FIELDS)[number],
  expected: Expected,
  actual: ReturnType<typeof actualOf>
) {
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

function sortKeys(value: object | null) {
  return (
    value &&
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    )
  );
}

async function loadCases(): Promise<Record<string, Case[]>> {
  const sets: Record<string, Case[]> = {};
  if (which !== "test") {
    const hand = JSON.parse(
      await readFile(`${ROOT}testset/handwritten.json`, "utf8")
    ) as {
      cases: { expect: Expected; tags?: string[]; text: string }[];
      defaultTags: string[];
      now: string;
    };
    sets.handwritten = hand.cases.map((c, index) => ({
      expect: c.expect,
      id: `hand/${index}`,
      now: hand.now,
      tags: c.tags ?? hand.defaultTags,
      text: c.text,
    }));
  }
  const testFile = `${ROOT}testset/test.jsonl`;
  if (which !== "handwritten" && existsSync(testFile)) {
    const rows = (await readFile(testFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const byFocus: Record<string, Case[]> = {};
    for (const row of rows) {
      const c: Case = {
        expect: row.fields,
        id: row.id,
        now: row.now,
        tags: row.tagList,
        text: row.text,
      };
      for (const key of ["test", `test:${row.focus}`]) {
        byFocus[key] = [...(byFocus[key] ?? []), c];
      }
    }
    Object.assign(sets, byFocus);
  }
  return sets;
}

const file = await readFile(`${run}/task-parser.bin`);
const parser = createTaskParser(
  file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength
  ) as ArrayBuffer
);
const sets = await loadCases();
for (const [name, cases] of Object.entries(sets)) {
  const correct: Record<string, number> = Object.fromEntries(
    FIELDS.map((f) => [f, 0])
  );
  let all = 0;
  const failures: string[] = [];
  let elapsed = 0;
  for (const c of cases) {
    const started = performance.now();
    const parsed = await parser.parse(c.text, {
      now: Temporal.ZonedDateTime.from(c.now),
      tags: c.tags.map((tagName) => ({ id: tagName, name: tagName })),
    });
    elapsed += performance.now() - started;
    const actual = actualOf(parsed);
    const wrong = FIELDS.filter((field) => !equal(field, c.expect, actual));
    for (const field of FIELDS) {
      correct[field] = (correct[field] ?? 0) + (wrong.includes(field) ? 0 : 1);
    }
    if (wrong.length === 0) {
      all += 1;
    } else if (failures.length < show) {
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
    `\n== ${name}: ${cases.length} cases, all fields right ${pct(all)}, ${(elapsed / cases.length).toFixed(1)} ms/case`
  );
  console.log(
    FIELDS.map((field) => `${field} ${pct(correct[field] ?? 0)}`).join(" | ")
  );
  if (name === "handwritten" || name === "test") {
    console.log(failures.join("\n"));
  }
}
