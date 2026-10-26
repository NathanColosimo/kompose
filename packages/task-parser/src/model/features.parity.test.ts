import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { encode } from "./features";
import { WordPiece } from "./tokenizer";

const data = new URL("../../training/data/", import.meta.url).pathname;
const casesFile = `${data}features-parity.json`;
const vocabFile = `${data}tokenizer-parity.json`;

describe.skipIf(!(existsSync(casesFile) && existsSync(vocabFile)))(
  "features parity with Python",
  () => {
    test("every dumped case matches", () => {
      const { vocab } = JSON.parse(readFileSync(vocabFile, "utf8")) as {
        vocab: string[];
      };
      const tokenizer = new WordPiece(vocab);
      const cases = JSON.parse(readFileSync(casesFile, "utf8")) as (Record<
        string,
        unknown
      > & {
        tagList: string[];
        text: string;
      })[];
      const fields = [
        "ids",
        "specials",
        "shapes",
        "segments",
        "spaced",
        "overlap",
        "tagPositions",
        "offsets",
        "links",
      ];
      const failures: string[] = [];
      for (const expected of cases) {
        const got = encode(
          tokenizer,
          expected.text,
          expected.tagList
        ) as unknown as Record<string, unknown>;
        for (const field of fields) {
          if (JSON.stringify(got[field]) !== JSON.stringify(expected[field])) {
            failures.push(
              `${field} differs for ${JSON.stringify(expected.text)} ${JSON.stringify(expected.tagList)}\n py ${JSON.stringify(expected[field])}\n ts ${JSON.stringify(got[field])}`
            );
          }
        }
      }
      expect(failures.slice(0, 5)).toEqual([]);
    });
  }
);
