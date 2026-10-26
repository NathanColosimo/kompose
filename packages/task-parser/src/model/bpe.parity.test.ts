import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { BytePairEncoding } from "./bpe";

const file = new URL(
  "../../training/data/tokenizer-parity-ettin-17m.json",
  import.meta.url
).pathname;

describe.skipIf(!existsSync(file))("BPE parity with Hugging Face", () => {
  test("every dumped case matches ids and offsets", () => {
    const { added, cases, merges, vocab } = JSON.parse(
      readFileSync(file, "utf8")
    ) as {
      added: string[];
      cases: { ids: number[]; offsets: [number, number][]; text: string }[];
      merges: string[];
      vocab: string[];
    };
    const tokenizer = new BytePairEncoding(vocab, merges, added);
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
    expect(failures.length).toBe(0);
  });
});
