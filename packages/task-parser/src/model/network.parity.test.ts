import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { encode, viterbi } from "./features";
import { forward } from "./network";
import { WordPiece } from "./tokenizer";
import { readWeights } from "./weights";

const run =
  process.env.TASK_PARSER_RUN ??
  new URL("../../training/runs/smoke/", import.meta.url).pathname;
const weightsFile = `${run}/task-parser.bin`;
const casesFile = `${run}/logits-parity.json`;

describe.skipIf(!(existsSync(weightsFile) && existsSync(casesFile)))(
  "forward pass parity with PyTorch",
  () => {
    test("logits match the dequantized PyTorch model", () => {
      const file = readFileSync(weightsFile);
      const weights = readWeights(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      );
      const tokenizer = new WordPiece(weights.vocab);
      const cases = JSON.parse(readFileSync(casesFile, "utf8")) as {
        spans: number[];
        tagList: string[];
        tags: number[];
        text: string;
        viterbi: number[];
      }[];
      let worst = 0;
      let decodedDifferently = 0;
      for (const expected of cases) {
        const encoded = encode(tokenizer, expected.text, expected.tagList);
        const logits = forward(weights, encoded);
        if (
          JSON.stringify(viterbi(encoded, logits.spans)) !==
          JSON.stringify(expected.viterbi)
        ) {
          decodedDifferently += 1;
        }
        expect(logits.spans.length).toBe(expected.spans.length);
        expected.spans.forEach((value, i) => {
          worst = Math.max(
            worst,
            Math.abs(value - (logits.spans[i] as number))
          );
        });
        expected.tags.forEach((value, i) => {
          worst = Math.max(worst, Math.abs(value - (logits.tags[i] as number)));
        });
      }
      expect(worst).toBeLessThan(1e-3);
      expect(decodedDifferently).toBe(0);
    });
  }
);
