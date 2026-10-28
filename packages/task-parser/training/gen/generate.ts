/**
 * Bulk training data: batches of planned slots sent to gpt-6-luna.
 * Usage: bun gen/generate.ts <name> <batches> [concurrency] [seed] [focus=all|weak]
 * Writes data/raw/<name>/<batch>.json; existing batches are skipped.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import { type Focus, type Persona, planSlot, rng, type Slot } from "./plan";

/** The final answer: examples written for the batch's slots. */
const outputSchema = {
  additionalProperties: false,
  properties: {
    examples: {
      items: {
        additionalProperties: false,
        properties: {
          marked: { type: "string" },
          slot: { type: "integer" },
          tags: { items: { type: "string" }, type: "array" },
        },
        required: ["slot", "marked", "tags"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["examples"],
  type: "object",
};

const ROOT = new URL("../", import.meta.url).pathname;
const SLOTS_PER_BATCH = 15;

const [
  name = "train",
  batchArg = "4",
  concurrencyArg = "16",
  seedArg = "1",
  focusArg = "all",
] = process.argv.slice(2);
const focus = focusArg as Focus;
const batches = Number(batchArg);
const concurrency = Number(concurrencyArg);
const seed = Number(seedArg);

const spec = await readFile(`${ROOT}SPEC.md`, "utf8");
const seeds = `${ROOT}data/seeds/`;
const { train: tagSets } = JSON.parse(
  await readFile(`${seeds}split.json`, "utf8")
) as {
  train: string[][];
};
const personas = JSON.parse(
  await readFile(`${seeds}personas.json`, "utf8")
) as Persona[];

function describeSlot(slot: Slot, index: number) {
  return [
    `Slot ${index + 1}`,
    `  user's tags: ${JSON.stringify(slot.tags)}`,
    `  persona: ${slot.persona.description} Writing habits: ${slot.persona.writingHabits}`,
    `  style: ${slot.style}`,
    `  must contain labels: ${slot.labels.join(", ")} (other labels are fine if natural)`,
    `  tags: ${slot.tagMode}`,
    slot.twist ? `  twist: ${slot.twist}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generationPrompt(slots: Slot[]) {
  const examples = EXAMPLES.map(
    (example) =>
      `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
  ).join("\n\n");
  return `You write training data for a small model that turns quick-add text into a task. Do not run any commands or read files; answer only with the JSON object.

${spec}

## Reference examples

${examples}

## Your job

Write one example per slot below. Each is what this persona would really type (or dictate) into a quick-add box to create ONE task, in the given style. Labels must follow the spec exactly; that matters more than anything else:
- Removing the markup must leave exactly the text the person typed.
- Span boundaries: no cue words inside S/U/M spans ("by", "due", "for", "on", "at" stay outside), no padding spaces.
- Every date/time phrase you label S, U or R must be a concrete, resolvable expression.
- "tags" lists only names from that slot's tag list, spelled exactly as listed, chosen by the spec's rules.
- Every word about the task itself is inside T or D. Never leave a clause describing the task unlabelled.
- Every hashtag is G.
- If a slot's requirements conflict with realism or with the spec, follow the spec and stay realistic.
- Do not start most examples with "please" or "can you"; vary openings.
Before answering, re-check every example against these rules and its own slot's tag list.
Vary sentence shapes, vocabulary and topics; do not reuse the reference examples' wording.

${slots.map(describeSlot).join("\n\n")}`;
}

const random = rng(seed);
const dir = `${ROOT}data/raw/${name}/`;
await mkdir(dir, { recursive: true });

const jobs = Array.from({ length: batches }, (_, batch) => {
  const slots = Array.from({ length: SLOTS_PER_BATCH }, () =>
    planSlot(random, tagSets, personas, focus)
  );
  const file = `${dir}${String(batch).padStart(5, "0")}.json`;
  return async () => {
    if (existsSync(file)) {
      return "skipped";
    }
    const output = await codexJson<{
      examples: { marked: string; slot: number; tags: string[] }[];
    }>({
      model: "gpt-6-luna",
      effort: "medium",
      prompt: generationPrompt(slots),
      schema: outputSchema,
    });
    await writeFile(file, JSON.stringify({ output: output.examples, slots }));
    return "ok";
  };
});

let done = 0;
const started = Date.now();
await pool(jobs, concurrency, (index, result) => {
  done += 1;
  if (result instanceof Error) {
    console.log(`batch ${index} failed: ${result.message.slice(0, 300)}`);
  }
  if (done % 10 === 0 || done === jobs.length) {
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(`${done}/${jobs.length} batches, ${minutes} min`);
  }
});
await writeFile(`${ROOT}data/raw/${name}.done`, new Date().toISOString());
