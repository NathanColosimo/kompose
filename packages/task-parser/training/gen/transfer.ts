/**
 * Unlabelled inputs for distillation: the text of raw generations (their
 * labels are ignored), which a teacher labels during training.
 * Usage: bun gen/transfer.ts <raw name>   → data/transfer/<name>.jsonl
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import { MarkupError, parseMarkup } from "../../src/spans";
import { ROOT, writeJsonl } from "./common";

const name = process.argv[2] ?? "";
const dir = `${ROOT}data/raw/${name}/`;
const rows: object[] = [];
const seen = new Set<string>();
for (const file of (await readdir(dir))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const batch = JSON.parse(await readFile(dir + file, "utf8")) as {
    output: { marked: string; slot: number }[];
    slots: { tags: string[] }[];
  };
  for (const [index, item] of batch.output.entries()) {
    let text: string;
    try {
      text = parseMarkup(item.marked).text;
    } catch (error) {
      if (error instanceof MarkupError) {
        continue;
      }
      throw error;
    }
    const tagList = batch.slots[item.slot - 1]?.tags;
    if (!(tagList && text.trim()) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    rows.push({
      id: `${name}-transfer/${file.replace(".json", "")}/${index}`,
      spans: [],
      tagList,
      tags: [],
      text,
      transfer: true,
    });
  }
}
await mkdir(`${ROOT}data/transfer`, { recursive: true });
await writeJsonl(`${ROOT}data/transfer/${name}.jsonl`, rows);
console.log(`${rows.length} transfer rows`);
