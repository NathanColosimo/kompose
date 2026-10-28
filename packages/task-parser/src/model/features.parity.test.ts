import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { encode } from "./features";
import { WordPiece } from "./tokenizer";

const data = new URL("../../training/data/", import.meta.url).pathname;
const casesFile = `${data}features-parity.json`;
const vocabFile = `${data}tokenizer-parity.json`;

test.skipIf(!(existsSync(casesFile) && existsSync(vocabFile)))(
  "features match Python's for every dumped case",
  () => {
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
  }
);
