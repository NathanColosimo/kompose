/**
 * Where test failures come from: model spans vs date/field resolution.
 * Resolves the gold spans too, so resolver errors show up on their own.
 * Usage: bun gen/analyze.ts <run dir> [--show N]
 */
import { readFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { resolveFields } from "../../src/fields";
import { decodeSpans, encode, viterbi } from "../../src/model/features";
import { forward } from "../../src/model/network";
import { readWeights } from "../../src/model/weights";
import { tagKey, tokenizerFor } from "../../src/parser";
import { parseMarkup, type Span } from "../../src/spans";

const ROOT = new URL("../", import.meta.url).pathname;
const [run = ""] = process.argv.slice(2);
const showAt = process.argv.indexOf("--show");
const show = showAt > 0 ? Number(process.argv[showAt + 1]) : 0;
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
const PUNCT = /[^\p{L}\p{N}]+/gu;
const norm = (v: unknown) =>
  String(v ?? "")
    .replace(PUNCT, " ")
    .trim()
    .toLowerCase();
const sortKeys = (v: object | null) =>
  v &&
  Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));

// biome-ignore lint/suspicious/noExplicitAny: analysis script
function same(field: string, expected: any, actual: any) {
  if (field === "title" || field === "description") {
    return norm(expected[field]) === norm(actual[field]);
  }
  if (field === "tags" || field === "links") {
    return (
      JSON.stringify([...(expected[field] ?? [])].sort()) ===
      JSON.stringify([...(actual[field] ?? [])].sort())
    );
  }
  if (field === "recurrence") {
    return (
      JSON.stringify(sortKeys(expected.recurrence ?? null)) ===
      JSON.stringify(sortKeys(actual.recurrence ?? null))
    );
  }
  return (expected[field] ?? null) === (actual[field] ?? null);
}
// biome-ignore lint/suspicious/noExplicitAny: analysis script
const flat = (f: any, tags: string[]) => ({
  description: f.description,
  dueDate: f.dueDate?.toString() ?? null,
  durationMinutes: f.durationMinutes,
  links: f.links,
  recurrence: f.recurrence,
  startDate: f.startDate?.toString() ?? null,
  startTime: f.startTime?.toString() ?? null,
  tags,
  title: f.title,
});
const byLabel = (spans: Span[] | { label: string; text: string }[]) => {
  const out: Record<string, string> = {};
  for (const s of spans) {
    out[s.label] = `${out[s.label] ?? ""} ${norm(s.text)}`.trim();
  }
  return out;
};

const file = await readFile(`${run}/task-parser.bin`);
const weights = readWeights(
  file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength
  ) as ArrayBuffer
);
const tokenizer = tokenizerFor(weights);
const rows = (await readFile(`${ROOT}testset/test.jsonl`, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
let tModel = 0,
  tResolve = 0,
  oracleAll = 0,
  modelAll = 0;
const oracleWrong: Record<string, number> = {},
  modelWrong: Record<string, number> = {};
const blame: Record<string, number> = {};
const examples: string[] = [];
for (const row of rows) {
  const now = Temporal.ZonedDateTime.from(row.now);
  const gold = parseMarkup(row.marked);
  const goldTagNames = row.fields.tags as string[];
  const oracle = flat(
    await resolveFields({
      now,
      spans: gold.spans,
      tagNames: goldTagNames,
      text: row.text,
    }),
    goldTagNames
  );
  const oWrong = FIELDS.filter((f) => !same(f, row.fields, oracle));
  for (const f of oWrong) {
    oracleWrong[f] = (oracleWrong[f] ?? 0) + 1;
  }
  if (oWrong.length === 0) {
    oracleAll += 1;
  }

  const t0 = performance.now();
  const enc = encode(tokenizer, row.text, row.tagList, {
    late: weights.config.late_tags,
  });
  const logits = forward(weights, enc);
  const spans = decodeSpans(enc, viterbi(enc, logits.spans), row.text);
  const named = new Set(
    spans.filter((s) => s.label === "G").map((s) => tagKey(s.text))
  );
  const tags = (row.tagList as string[]).filter(
    (name, i) =>
      named.has(tagKey(name)) ||
      1 / (1 + Math.exp(-(logits.tags[i] as number))) >= 0.8
  );
  const t1 = performance.now();
  tModel += t1 - t0;
  const fields = flat(
    await resolveFields({
      now,
      spans: spans as Span[],
      tagNames: tags,
      text: row.text,
    }),
    tags
  );
  tResolve += performance.now() - t1;
  const wrong = FIELDS.filter((f) => !same(f, row.fields, fields));
  for (const f of wrong) {
    modelWrong[f] = (modelWrong[f] ?? 0) + 1;
  }
  if (wrong.length === 0) {
    modelAll += 1;
    continue;
  }
  // Blame: a field is the resolver's fault when the spans feeding it match gold.
  const g = byLabel(gold.spans),
    p = byLabel(spans);
  const source: Record<string, string[]> = {
    title: ["T"],
    description: ["D"],
    startDate: ["S", "R"],
    startTime: ["S", "R"],
    dueDate: ["U", "S", "R"],
    durationMinutes: ["M", "S"],
    recurrence: ["R", "S", "U"],
    links: [],
    tags: ["G"],
  };
  for (const f of wrong) {
    const spansMatch = (source[f] ?? []).every(
      (l) => (g[l] ?? "") === (p[l] ?? "")
    );
    const key =
      f === "tags" ? "tags:model" : `${f}:${spansMatch ? "resolver" : "model"}`;
    blame[key] = (blame[key] ?? 0) + 1;
    if (examples.length < show && spansMatch && f !== "tags") {
      examples.push(
        `${row.id} ${f} ${JSON.stringify(row.text)} now=${row.now}\n  gold ${row.marked}\n  want ${JSON.stringify(row.fields[f])} got ${JSON.stringify(fields[f])}`
      );
    }
  }
}
const n = rows.length,
  pct = (v: number) => `${((100 * v) / n).toFixed(1)}%`;
console.log(`model: all ${pct(modelAll)}  oracle spans: all ${pct(oracleAll)}`);
console.log(
  `ms/case model ${(tModel / n).toFixed(2)} resolve ${(tResolve / n).toFixed(2)}`
);
console.log(
  "oracle wrong",
  Object.fromEntries(Object.entries(oracleWrong).map(([k, v]) => [k, pct(v)]))
);
console.log(
  "model wrong",
  Object.fromEntries(Object.entries(modelWrong).map(([k, v]) => [k, pct(v)]))
);
console.log(
  "blame",
  Object.fromEntries(
    Object.entries(blame)
      .sort()
      .map(([k, v]) => [k, pct(v)])
  )
);
console.log(examples.join("\n"));
