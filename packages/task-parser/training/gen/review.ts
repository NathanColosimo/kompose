/**
 * Settles two disagreeing readings of the same text: a label vs an
 * out-of-fold model (model/suspects.py → data/overrides.jsonl, which
 * model/train.py applies on load), or two labelling passes (merge.ts →
 * tiebreaks). The reviewer sees both readings in random order, unattributed,
 * and writes the correct one.
 * Usage: bun gen/review.ts <in.jsonl> <out.jsonl> [model] [effort] [limit] [concurrency]
 * Paths are under data/; output is appended (resumable).
 */
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { parseMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import { rng } from "./plan";
import { tidy } from "./validate";

const ROOT = new URL("../", import.meta.url).pathname;
const [
  input = "suspects.jsonl",
  output = "overrides.jsonl",
  model = "gpt-6.1-sol",
  effort = "high",
  limitArg = "100000",
  concurrencyArg = "16",
] = process.argv.slice(2);
const BATCH = 12;

interface Suspect {
  id: string;
  marked: string;
  modelMarked: string;
  modelTags: string[];
  tagList: string[];
  tags: string[];
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

const out = `${ROOT}data/${output}`;
const done = new Set(
  (await readJsonl<{ text: string }>(out)).map((row) => row.text)
);
const suspects = (await readJsonl<Suspect>(`${ROOT}data/${input}`))
  .filter((suspect) => !done.has(suspect.text))
  .slice(0, Number(limitArg));
const spec = await readFile(`${ROOT}SPEC.md`, "utf8");
const examples = EXAMPLES.map(
  (example) =>
    `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
).join("\n\n");
const flip = rng(9);

const schema = {
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

function prompt(batch: Suspect[]) {
  const shown = batch.map((suspect, index) => {
    const readings = [
      `${suspect.marked}  → tags ${JSON.stringify(suspect.tags)}`,
      `${suspect.modelMarked}  → tags ${JSON.stringify(suspect.modelTags)}`,
    ];
    if (flip() < 0.5) {
      readings.reverse();
    }
    return `Item ${index + 1}\n  tags list: ${JSON.stringify(suspect.tagList)}\n  text: ${JSON.stringify(suspect.text)}\n  reading 1: ${readings[0]}\n  reading 2: ${readings[1]}`;
  });
  return `You check labels for training data of a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${examples}

## Your job

Each item has two candidate readings that disagree. Either may be right, or neither. Apply the spec carefully, word by word, and write the correct markup and tags.
- Your markup's plain text must equal the item's text exactly, character for character. Only insert [X: and ].
- Tags only from that item's list, spelled exactly, and only when the spec's rules justify them.
Return one entry per item with "item" set to its number.

${shown.join("\n\n")}`;
}

const batches: Suspect[][] = [];
for (let first = 0; first < suspects.length; first += BATCH) {
  batches.push(suspects.slice(first, first + BATCH));
}
let reviewed = 0;
let changed = 0;
const started = Date.now();
await pool(
  batches.map((batch) => async () => {
    const result = await codexJson<{
      items: { item: number; marked: string; tags: string[] }[];
    }>({
      effort: effort as "high",
      model,
      prompt: prompt(batch),
      schema,
    });
    const lines = result.items.flatMap((entry) => {
      const suspect = batch[entry.item - 1];
      if (!suspect) {
        return [];
      }
      try {
        const { spans, text } = parseMarkup(entry.marked);
        if (text !== suspect.text) {
          return [];
        }
        const tags = entry.tags.filter((tag) => suspect.tagList.includes(tag));
        reviewed += 1;
        changed += entry.marked === suspect.marked ? 0 : 1;
        return [
          JSON.stringify({
            id: suspect.id,
            spans: spans.map((span) => tidy(span, text)),
            tagList: suspect.tagList,
            tags,
            text,
          }),
        ];
      } catch {
        return [];
      }
    });
    if (lines.length > 0) {
      await appendFile(out, `${lines.join("\n")}\n`);
    }
  }),
  Number(concurrencyArg),
  (index, result) => {
    if (result instanceof Error) {
      console.log(`review ${index} failed: ${result.message.slice(0, 200)}`);
    }
    if (index % 20 === 0) {
      const minutes = ((Date.now() - started) / 60_000).toFixed(1);
      console.log(`${reviewed} reviewed, ${changed} changed, ${minutes} min`);
    }
  }
);
console.log(`review done: ${reviewed} reviewed, ${changed} changed`);
