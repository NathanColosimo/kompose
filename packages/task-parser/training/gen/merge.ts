/**
 * Final labels from two independent Luna passes (finalize.ts ... train-l1 /
 * train-l2). Where both passes agree the label is kept; where they disagree
 * the item goes to data/disagree-<name>.jsonl for a tiebreak (review.ts),
 * whose answers in data/tiebreak-<name>.jsonl are used once they exist.
 * Batches Sol finalized (data/final/<name>/) are taken as they are.
 * Usage: bun gen/merge.ts <name>  → data/final/<name>-merged/
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseMarkup, toMarkup } from "../../src/spans";
import { tidy } from "./validate";

const ROOT = new URL("../", import.meta.url).pathname;
const [name = "train"] = process.argv.slice(2);
const final = (suffix: string) => `${ROOT}data/final/${name}${suffix}/`;
const outDir = final("-merged");
await mkdir(outDir, { recursive: true });

interface Item {
  marked: string;
  tagList: string[];
  tags: string[];
}

async function items(dir: string, file: string): Promise<Item[] | null> {
  return existsSync(dir + file)
    ? (JSON.parse(await readFile(dir + file, "utf8")).items as Item[])
    : null;
}

/** Markup after the validator's edge clean-up, so trivia don't count as disagreement. */
function canonical(marked: string) {
  try {
    const { spans, text } = parseMarkup(marked);
    return toMarkup(
      text,
      spans.map((span) => tidy(span, text)).filter((span) => span.text)
    );
  } catch {
    return marked;
  }
}

function plain(marked: string) {
  try {
    return parseMarkup(marked).text;
  } catch {
    return null;
  }
}

const sameTags = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const ties = new Map<string, Item>();
const tieFile = `${ROOT}data/tiebreak-${name}.jsonl`;
if (existsSync(tieFile)) {
  for (const line of (await readFile(tieFile, "utf8")).split("\n")) {
    if (line) {
      const row = JSON.parse(line);
      ties.set(row.text, {
        marked: toMarkup(row.text, row.spans),
        tagList: row.tagList ?? [],
        tags: row.tags,
      });
    }
  }
}

const files = new Set([
  ...(await readdir(final("-l1"))),
  ...(existsSync(final("")) ? await readdir(final("")) : []),
]);
const disagree: string[] = [];
const counts = { agreed: 0, onlyOne: 0, sol: 0, tied: 0, waiting: 0 };
for (const file of [...files].filter((f) => f.endsWith(".json")).sort()) {
  const sol = await items(final(""), file);
  if (sol) {
    counts.sol += sol.length;
    await writeFile(outDir + file, JSON.stringify({ items: sol }));
    continue;
  }
  const [first, second] = await Promise.all([
    items(final("-l1"), file),
    items(final("-l2"), file),
  ]);
  if (!(first && second)) {
    continue;
  }
  const byText = new Map(second.map((item) => [plain(item.marked), item]));
  const merged: Item[] = [];
  for (const item of first) {
    const text = plain(item.marked);
    const other = text === null ? undefined : byText.get(text);
    if (!(text && other)) {
      counts.onlyOne += 1;
      continue;
    }
    if (
      canonical(item.marked) === canonical(other.marked) &&
      sameTags(item.tags, other.tags)
    ) {
      counts.agreed += 1;
      merged.push(item);
      continue;
    }
    const tie = ties.get(text);
    if (tie) {
      counts.tied += 1;
      merged.push({ ...tie, tagList: item.tagList });
      continue;
    }
    counts.waiting += 1;
    disagree.push(
      JSON.stringify({
        id: `${name}/${file.replace(".json", "")}/${merged.length}`,
        marked: item.marked,
        modelMarked: other.marked,
        modelTags: other.tags,
        tagList: item.tagList,
        tags: item.tags,
        text,
      })
    );
  }
  await writeFile(outDir + file, JSON.stringify({ items: merged }));
}
await writeFile(`${ROOT}data/disagree-${name}.jsonl`, `${disagree.join("\n")}\n`);
console.log(JSON.stringify(counts));
