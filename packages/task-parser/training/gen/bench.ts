/**
 * Forward-pass latency over test inputs (no date resolution).
 * Usage: bun gen/bench.ts <run dir> [repeats=1]
 */
import { readFile } from "node:fs/promises";
import { encode } from "../../src/model/features";
import { forward } from "../../src/model/network";
import { readWeights } from "../../src/model/weights";
import { tokenizerFor } from "../../src/parser";

const ROOT = new URL("../", import.meta.url).pathname;
const [run = "", repeatsArg = "1"] = process.argv.slice(2);
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
const inputs = rows.map((row) =>
  encode(tokenizer, row.text, row.tagList, { late: weights.config.late_tags })
);
for (const input of inputs.slice(0, 50)) {
  forward(weights, input); // warm up
}
const times: number[] = [];
let tokens = 0;
for (let r = 0; r < Number(repeatsArg); r += 1) {
  for (const input of inputs) {
    const started = performance.now();
    forward(weights, input);
    times.push(performance.now() - started);
    tokens += input.ids.length;
  }
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(
  `forward: mean ${mean.toFixed(2)} ms, p50 ${times[Math.floor(times.length / 2)]?.toFixed(2)}, p90 ${times[Math.floor(times.length * 0.9)]?.toFixed(2)}, ${(tokens / times.length).toFixed(1)} tokens/input`
);
