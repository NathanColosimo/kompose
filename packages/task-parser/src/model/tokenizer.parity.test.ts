import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { WordPiece } from "./tokenizer";

const file = new URL(
  "../../training/data/tokenizer-parity.json",
  import.meta.url
).pathname;

test.skipIf(!existsSync(file))(
  "WordPiece matches Hugging Face ids and offsets on every dumped case",
  () => {
    const { cases, vocab } = JSON.parse(readFileSync(file, "utf8")) as {
      cases: { ids: number[]; offsets: [number, number][]; text: string }[];
      vocab: string[];
    };
    const tokenizer = new WordPiece(vocab);
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
  }
);
