/**
 * Independent review of clean examples by a stronger model. Each example gets
 * a verdict and, when wrong, corrected markup and tags.
 * Usage: bun gen/audit.ts <clean name> <sample size|all> <out name> [concurrency] [model] [effort]
 * Writes data/audit/<out>.jsonl.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { parseMarkup, toMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import { rng } from "./plan";
import type { CleanExample } from "./validate";

const ROOT = new URL("../", import.meta.url).pathname;
const [
  name = "train",
  sizeArg = "100",
  out = "audit",
  concurrencyArg = "8",
  model = "gpt-6.1-sol",
  effort = "high",
] = process.argv.slice(2);
const spec = await readFile(`${ROOT}SPEC.md`, "utf8");

const all = (await readFile(`${ROOT}data/clean/${name}.jsonl`, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as CleanExample);
const random = rng(11);
const sample =
  sizeArg === "all"
    ? all
    : [...all].sort(() => random() - 0.5).slice(0, Number(sizeArg));

const outFile = `${ROOT}data/audit/${out}.jsonl`;
await mkdir(`${ROOT}data/audit`, { recursive: true });
const done = new Set(
  existsSync(outFile)
    ? (await readFile(outFile, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).id)
    : []
);
const todo = sample.filter((example) => !done.has(example.id));

const schema = {
  additionalProperties: false,
  properties: {
    reviews: {
      items: {
        additionalProperties: false,
        properties: {
          correctedMarked: { type: "string" },
          correctedTags: { items: { type: "string" }, type: "array" },
          issues: { items: { type: "string" }, type: "array" },
          item: { type: "integer" },
          verdict: { enum: ["correct", "wrong"], type: "string" },
        },
        required: [
          "item",
          "verdict",
          "issues",
          "correctedMarked",
          "correctedTags",
        ],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["reviews"],
  type: "object",
};

const examples = EXAMPLES.map(
  (example) =>
    `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
).join("\n\n");

const BATCH = 20;
const jobs: (() => Promise<void>)[] = [];
for (let first = 0; first < todo.length; first += BATCH) {
  const batch = todo.slice(first, first + BATCH);
  jobs.push(async () => {
    const prompt = `You are the quality reviewer for training data of a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${examples}

## Your job

Review each labelled item strictly against the spec. An item is "wrong" if any span label or boundary differs from what the spec requires, a task word is left unlabelled, or the tags are wrong (missing a tag the spec requires, or including one the text doesn't justify).
- "issues": short descriptions of each problem (empty when correct). Start each with a category: boundary, label, unlabelled, tag-missing, tag-extra, hashtag, other.
- "correctedMarked": the fully corrected markup (identical to the input when correct). Its plain text must equal the item's text exactly; only move or change markup.
- "correctedTags": the correct tags, only from that item's list, spelled exactly.

${batch
  .map(
    (example, index) =>
      `Item ${index + 1}\n  tags list: ${JSON.stringify(example.tagList)}\n  labelled: ${toMarkup(example.text, example.spans)}\n  tags: ${JSON.stringify(example.tags)}`
  )
  .join("\n\n")}`;
    const result = await codexJson<{
      reviews: {
        correctedMarked: string;
        correctedTags: string[];
        issues: string[];
        item: number;
        verdict: string;
      }[];
    }>({ effort: effort as "high", model, prompt, schema });
    const lines = result.reviews.flatMap((review) => {
      const example = batch[review.item - 1];
      if (!example) {
        return [];
      }
      let textMatches = false;
      try {
        textMatches = parseMarkup(review.correctedMarked).text === example.text;
      } catch {
        textMatches = false;
      }
      return [
        JSON.stringify({
          ...review,
          id: example.id,
          original: toMarkup(example.text, example.spans),
          originalTags: example.tags,
          tagList: example.tagList,
          textMatches,
        }),
      ];
    });
    await appendFile(outFile, lines.map((line) => `${line}\n`).join(""));
  });
}
const started = Date.now();
let finished = 0;
await pool(jobs, Number(concurrencyArg), (index, result) => {
  finished += 1;
  if (result instanceof Error) {
    console.log(`audit ${index} failed: ${result.message.slice(0, 200)}`);
  }
  if (finished % 5 === 0 || finished === jobs.length) {
    console.log(
      `${finished}/${jobs.length} audit batches, ${((Date.now() - started) / 60_000).toFixed(1)} min`
    );
  }
});
