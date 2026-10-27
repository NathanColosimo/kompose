/**
 * Unlabelled inputs for distillation: the text of raw generations (their
 * labels are ignored), which a teacher labels during training.
 * Usage: bun gen/transfer.ts <raw name> [skip clean file...]
 * Writes data/transfer/<name>.jsonl; texts already in the skip files are left out.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { MarkupError, parseMarkup } from "../../src/spans";

const ROOT = new URL("../", import.meta.url).pathname;
const [name = "", ...skipFiles] = process.argv.slice(2);
const skip = new Set<string>();
for (const file of skipFiles) {
  if (existsSync(file)) {
    for (const line of (await readFile(file, "utf8"))
      .split("\n")
      .filter(Boolean)) {
      skip.add((JSON.parse(line) as { text: string }).text);
    }
  }
}
const dir = `${ROOT}data/raw/${name}/`;
const rows: string[] = [];
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
    if (!(tagList && text.trim()) || skip.has(text) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    rows.push(
      JSON.stringify({
        id: `${name}-transfer/${file.replace(".json", "")}/${index}`,
        spans: [],
        tagList,
        tags: [],
        text,
        transfer: true,
      })
    );
  }
}
await mkdir(`${ROOT}data/transfer`, { recursive: true });
await writeFile(`${ROOT}data/transfer/${name}.jsonl`, `${rows.join("\n")}\n`);
console.log(`${rows.length} transfer rows`);
