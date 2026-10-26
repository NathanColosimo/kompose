/**
 * Second chance for rejected generations: gpt-6-luna relabels them without
 * changing the text. Usage: bun gen/repair.ts <name> [concurrency]
 * Writes data/raw/<name>-repair/*.json in the same format as generate.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import { outputSchema } from "./schema";

const ROOT = new URL("../", import.meta.url).pathname;
const [name = "train", concurrencyArg = "16"] = process.argv.slice(2);
const spec = await readFile(`${ROOT}SPEC.md`, "utf8");

interface Reject {
  marked: string;
  reason: string;
  tagList: string[];
  tags: string[];
}

/** Plain text of possibly malformed markup ("(D:x)" and "[T:x]" forms). */
function plainText(marked: string) {
  return marked
    .replace(/\[[A-Z]:/g, "")
    .replace(/\]/g, "")
    .replace(/\(([A-Z]):/g, "(");
}

const rejects = (
  await readFile(`${ROOT}data/clean/${name}.rejects.jsonl`, "utf8")
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Reject)
  .filter((reject) => !reject.reason.startsWith("tag not in list"));

const dir = `${ROOT}data/raw/${name}-repair/`;
await mkdir(dir, { recursive: true });
const BATCH = 20;
const examples = EXAMPLES.map(
  (example) =>
    `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
).join("\n\n");

const jobs: (() => Promise<void>)[] = [];
for (let first = 0; first < rejects.length; first += BATCH) {
  const batch = rejects.slice(first, first + BATCH);
  const file = `${dir}${String(first / BATCH).padStart(5, "0")}.json`;
  jobs.push(async () => {
    if (existsSync(file)) {
      return;
    }
    const items = batch.map((reject, index) => ({
      slot: index + 1,
      tagList: reject.tagList,
      text: plainText(reject.marked),
    }));
    const prompt = `You fix labels in training data for a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples

${examples}

## Your job

Each item below is the plain text someone typed, with that user's tag list. Label it from scratch following the spec exactly, and choose its tags.
- The text inside your markup must be exactly the given text, character for character. Never add, remove or change a character; only insert [X: and ].
- Every word about the task itself must be inside T or D (background sentences and secondary actions are D).
- Tags come only from that item's list, spelled exactly; an empty list is fine.
Return one example per item with "slot" set to the item number.

${items.map((item) => `Item ${item.slot}\n  tags list: ${JSON.stringify(item.tagList)}\n  text: ${JSON.stringify(item.text)}`).join("\n\n")}`;
    const output = await codexJson<{
      examples: { marked: string; slot: number; tags: string[] }[];
    }>({
      effort: "medium",
      model: "gpt-6-luna",
      prompt,
      schema: outputSchema,
    });
    // Keep only answers whose text is unchanged.
    const kept = output.examples.filter((example) => {
      const item = items[example.slot - 1];
      try {
        return item && parseMarkup(example.marked).text === item.text;
      } catch {
        return false;
      }
    });
    await writeFile(
      file,
      JSON.stringify({
        output: kept,
        slots: items.map((item) => ({ labels: [], tags: item.tagList })),
      })
    );
  });
}
await pool(jobs, Number(concurrencyArg), (index, result) => {
  if (result instanceof Error) {
    console.log(`repair ${index} failed: ${result.message.slice(0, 200)}`);
  }
});
console.log(`repaired ${rejects.length} rejects in ${jobs.length} batches`);
