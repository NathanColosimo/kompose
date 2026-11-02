import { expect, test } from "bun:test";
import { parityFixture, shippedWeights } from "../test-fixtures";
import { encode } from "./features";
import { WordPiece } from "./tokenizer";
import { readWeights } from "./weights";

test("features match Python's for every dumped case", () => {
  const tokenizer = new WordPiece(readWeights(shippedWeights()).vocab);
  const cases =
    parityFixture<
      (Record<string, unknown> & { tagList: string[]; text: string })[]
    >("features.json");
  const failures: string[] = [];
  for (const expected of cases) {
    const got = encode(tokenizer, expected.text, expected.tagList);
    for (const [field, value] of Object.entries(got)) {
      if (JSON.stringify(value) !== JSON.stringify(expected[field])) {
        failures.push(
          `${field} differs for ${JSON.stringify(expected.text)} ${JSON.stringify(expected.tagList)}\n py ${JSON.stringify(expected[field])}\n ts ${JSON.stringify(value)}`
        );
      }
    }
  }
  expect(failures.slice(0, 5)).toEqual([]);
});
