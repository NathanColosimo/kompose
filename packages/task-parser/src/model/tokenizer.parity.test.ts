import { expect, test } from "bun:test";
import { parityFixture, shippedWeights } from "../test-fixtures";
import { WordPiece } from "./tokenizer";
import { readWeights } from "./weights";

test("WordPiece matches Hugging Face ids and offsets on every dumped case", () => {
  const tokenizer = new WordPiece(readWeights(shippedWeights()).vocab);
  const cases =
    parityFixture<
      { ids: number[]; offsets: [number, number][]; text: string }[]
    >("tokenizer.json");
  const failures: string[] = [];
  for (const { ids, offsets, text } of cases) {
    const pieces = tokenizer.encode(text);
    const got = JSON.stringify([
      pieces.map((p) => p.id),
      pieces.map((p) => [p.start, p.end]),
    ]);
    if (got !== JSON.stringify([ids, offsets])) {
      failures.push(
        `${JSON.stringify(text)}\n  hf: ${JSON.stringify([ids, offsets])}\n  ts: ${got}`
      );
    }
  }
  expect(failures.slice(0, 5)).toEqual([]);
});
