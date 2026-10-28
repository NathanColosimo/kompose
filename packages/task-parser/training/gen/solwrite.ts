/**
 * Training inputs written by gpt-6.1-sol in the test set's way (same
 * prompt and category mix, but training personas and tag lists), so the
 * model also learns from Sol's writing, not only Luna's.
 * Usage: bun gen/solwrite.ts <name> <calls> [concurrency] [seed]
 * Writes unlabelled batches to data/raw/<name>/ for gen/finalize.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { codexJson, pool } from "./codex";
import { rng } from "./plan";

const ROOT = new URL("../", import.meta.url).pathname;
const [
  name = "solwrite",
  callsArg = "600",
  concurrencyArg = "12",
  seedArg = "11",
] = process.argv.slice(2);
const random = rng(Number(seedArg));
const pick = <T>(items: readonly T[]) =>
  items[Math.floor(random() * items.length)] as T;

/** The test set's categories and their weights (gen/testset.ts compose). */
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
const WEIGHTED = FOCUS.flatMap(([focus, weight]) =>
  Array.from({ length: weight }, () => focus)
);

const seeds = `${ROOT}data/seeds/`;
const { train: tagSets } = JSON.parse(
  await readFile(`${seeds}split.json`, "utf8")
) as {
  train: string[][];
};
const personas = JSON.parse(
  await readFile(`${seeds}personas.json`, "utf8")
) as {
  description: string;
  writingHabits: string;
}[];
const dir = `${ROOT}data/raw/${name}/`;
await mkdir(dir, { recursive: true });

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

// Plan every call up front so a rerun resumes with the same plan.
const calls = Array.from({ length: Number(callsArg) }, (_, call) => ({
  call,
  focus: pick(WEIGHTED),
  items: Array.from({ length: 10 }, () => ({
    persona: pick(personas),
    tagList: [...pick(tagSets)].sort(() => random() - 0.5),
  })),
}));

await pool(
  calls.map(({ call, focus, items }) => async () => {
    const file = `${dir}${String(call).padStart(5, "0")}.json`;
    if (existsSync(file)) {
      return;
    }
    const prompt = `You write realistic inputs for a quick-add box that turns free text into a task. Do not run any commands; answer only with the JSON object.

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
    const output = result.inputs
      .filter((input) => items[input.item - 1] && input.text.trim())
      .map((input) => ({
        marked: input.text.trim(),
        slot: input.item,
        tags: [],
      }));
    const slots = items.map((item) => ({
      focus,
      persona: item.persona,
      tags: item.tagList,
    }));
    await writeFile(file, JSON.stringify({ output, slots }));
  }),
  Number(concurrencyArg),
  (index, result) => {
    if (result instanceof Error) {
      console.log(`call ${index} failed: ${result.message.slice(0, 200)}`);
    }
  }
);
await writeFile(
  `${ROOT}data/raw/${name}.done`,
  `${new Date().toISOString()}\n`
);
console.log("solwrite done");
