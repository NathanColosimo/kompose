import { expect, test } from "bun:test";
import { parityFixture, shippedWeights } from "../test-fixtures";
import { encode, viterbi } from "./features";
import { createNetwork } from "./network";
import { WordPiece } from "./tokenizer";
import { readWeights } from "./weights";

// The kernel rounds activations to 7 bits before each int8 layer
// (kernel.ts): over 12 layers logits drift (median 0.05, worst ~0.75 on
// v21q), and near-ties may decode differently.
test("int8 logits stay close to the dequantized PyTorch model", () => {
  const weights = readWeights(shippedWeights());
  const tokenizer = new WordPiece(weights.vocab);
  const forward = createNetwork(weights);
  const cases =
    parityFixture<
      {
        spans: number[];
        tagList: string[];
        tags: number[];
        text: string;
        viterbi: number[];
      }[]
    >("logits.json");
  let worst = 0;
  let decodedDifferently = 0;
  for (const expected of cases) {
    const encoded = encode(tokenizer, expected.text, expected.tagList);
    const logits = forward(encoded);
    if (
      JSON.stringify(viterbi(encoded, logits.spans)) !==
      JSON.stringify(expected.viterbi)
    ) {
      decodedDifferently += 1;
    }
    expect(logits.spans.length).toBe(expected.spans.length);
    expected.spans.forEach((value, i) => {
      worst = Math.max(worst, Math.abs(value - (logits.spans[i] as number)));
    });
    expected.tags.forEach((value, i) => {
      worst = Math.max(worst, Math.abs(value - (logits.tags[i] as number)));
    });
  }
  expect(worst).toBeLessThan(1);
  expect(decodedDifferently).toBeLessThan(cases.length * 0.05);
});
