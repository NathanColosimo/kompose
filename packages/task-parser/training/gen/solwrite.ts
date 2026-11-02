/**
 * Training inputs written by gpt-6.1-sol in the test set's way (same
 * prompt and category mix, but training personas and tag lists), so the
 * model also learns from Sol's writing, not only Luna's.
 * Usage: bun gen/solwrite.ts <name> <calls> [concurrency] [seed]
 * Writes unlabelled batches to data/raw/<name>/ for gen/finalize.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "./codex";
import {
  FOCUS_CALLS,
  pick,
  pickWriters,
  ROOT,
  readSeeds,
  rng,
  writeInputs,
} from "./common";

const [
  name = "solwrite",
  callsArg = "600",
  concurrencyArg = "12",
  seedArg = "11",
] = process.argv.slice(2);
const random = rng(Number(seedArg));
const seeds = await readSeeds("train");
const dir = `${ROOT}data/raw/${name}/`;
await mkdir(dir, { recursive: true });

// Plan every call up front so a rerun resumes with the same plan.
const calls = Array.from({ length: Number(callsArg) }, (_, call) => ({
  call,
  focus: pick(random, FOCUS_CALLS),
  items: pickWriters(random, seeds),
}));

await pool(
  "call",
  calls.map(({ call, focus, items }) => async () => {
    const file = `${dir}${String(call).padStart(5, "0")}.json`;
    if (existsSync(file)) {
      return;
    }
    const output = (await writeInputs(focus, items)).map(({ item, text }) => ({
      marked: text,
      slot: item,
      tags: [],
    }));
    const slots = items.map((item) => ({
      focus,
      persona: item.persona,
      tags: item.tagList,
    }));
    await writeFile(file, JSON.stringify({ output, slots }));
  }),
  Number(concurrencyArg)
);
await writeFile(
  `${ROOT}data/raw/${name}.done`,
  `${new Date().toISOString()}\n`
);
console.log("solwrite done");
