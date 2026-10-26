/**
 * Final labels: gpt-6.1-sol relabels every generated example (its draft
 * labels are only a hint). Follows a generation run as batches appear.
 * Usage: bun gen/finalize.ts <name> [concurrency] [effort] [model] [out name] [skip name]
 * Reads data/raw/<name>/*.json, writes data/final/<out name>/*.json; batches
 * already in data/final/<skip name>/ are left out.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseMarkup } from "../../src/spans";
import { codexJson, pool } from "./codex";
import { EXAMPLES } from "./examples";
import type { Slot } from "./plan";

const ROOT = new URL("../", import.meta.url).pathname;
const [
  name = "train",
  concurrencyArg = "16",
  effort = "high",
  model = "gpt-6.1-sol",
  outName = name,
  skipName = "",
] = process.argv.slice(2);
const skipDir = skipName ? `${ROOT}data/final/${skipName}/` : null;
const rawDir = `${ROOT}data/raw/${name}/`;
const outDir = `${ROOT}data/final/${outName}/`;
await mkdir(outDir, { recursive: true });

const schema = {
  additionalProperties: false,
  properties: {
    items: {
      items: {
        additionalProperties: false,
        properties: {
          item: { type: "integer" },
          marked: { type: "string" },
          tags: { items: { type: "string" }, type: "array" },
        },
        required: ["item", "marked", "tags"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["items"],
  type: "object",
};

const examples = EXAMPLES.map(
  (example) =>
    `tags list ${JSON.stringify(example.tagList)}\n${example.marked}\n→ tags ${JSON.stringify(example.tags)}`
).join("\n\n");

/** Plain text of a draft, even when its markup is malformed. */
function plainText(marked: string) {
  try {
    return parseMarkup(marked).text;
  } catch {
    return marked
      .replace(/\[[A-Z]:/g, "")
      .replace(/\]/g, "")
      .replace(/\(([A-Z]):/g, "(");
  }
}

async function finalize(file: string) {
  const spec = await readFile(`${ROOT}SPEC.md`, "utf8");
  const { output, slots } = JSON.parse(
    await readFile(rawDir + file, "utf8")
  ) as {
    output: { marked: string; slot: number; tags: string[] }[];
    slots: Slot[];
  };
  const items = output.flatMap((draft) => {
    const slot = slots[draft.slot - 1];
    const text = plainText(draft.marked).trim();
    return slot && text && !text.includes("[") && !text.includes("]")
      ? [{ draft: draft.marked, tagList: slot.tags, text }]
      : [];
  });
  if (items.length === 0) {
    await writeFile(outDir + file, JSON.stringify({ items: [] }));
    return;
  }
  const prompt = `You produce the final labels for training data of a task-parsing model. Do not run any commands; answer only with the JSON object.

${spec}

## Reference examples (correct)

${examples}

## Your job

For each item, label its text exactly as the spec requires and choose its tags. A draft labelling is given as a hint; it is often wrong (bad boundaries, unlabelled task words, unjustified tags), so judge every span and tag yourself.
- Your markup's plain text must equal the item's text exactly, character for character. Only insert [X: and ].
- Every word about the task itself is inside T or D. Every hashtag and @context is G.
- Tags only from that item's list, spelled exactly, and only when the spec's rules justify them.
Return one entry per item with "item" set to its number.

${items
  .map(
    (item, index) =>
      `Item ${index + 1}\n  tags list: ${JSON.stringify(item.tagList)}\n  text: ${JSON.stringify(item.text)}\n  draft: ${item.draft}`
  )
  .join("\n\n")}`;
  const result = await codexJson<{
    items: { item: number; marked: string; tags: string[] }[];
  }>({
    effort: effort as "high",
    model,
    prompt,
    schema,
  });
  const final = result.items.flatMap((entry) => {
    const item = items[entry.item - 1];
    if (!item) {
      return [];
    }
    try {
      if (parseMarkup(entry.marked).text !== item.text) {
        return [];
      }
    } catch {
      return [];
    }
    return [{ marked: entry.marked, tagList: item.tagList, tags: entry.tags }];
  });
  await writeFile(
    outDir + file,
    JSON.stringify({ items: final, requested: items.length })
  );
}

// Follow the generator: keep picking up new raw batches until it's done and
// nothing is left (the generator writes data/raw/<name>.done when finished).
const failed = new Set<string>();
for (;;) {
  const generatorDone = existsSync(`${ROOT}data/raw/${name}.done`);
  const files = existsSync(rawDir)
    ? (await readdir(rawDir)).filter((file) => file.endsWith(".json"))
    : [];
  const todo = files
    .filter(
      (file) =>
        !(
          existsSync(outDir + file) ||
          failed.has(file) ||
          (skipDir && existsSync(skipDir + file))
        )
    )
    .sort();
  if (todo.length === 0) {
    if (generatorDone) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    continue;
  }
  const started = Date.now();
  await pool(
    todo.map((file) => () => finalize(file)),
    Number(concurrencyArg),
    (index, result) => {
      if (result instanceof Error) {
        failed.add(todo[index] ?? "");
        console.log(
          `finalize ${todo[index]} failed: ${result.message.slice(0, 200)}`
        );
      }
    }
  );
  const total = (await readdir(outDir)).length;
  console.log(
    `finalized ${todo.length} batches in ${((Date.now() - started) / 60_000).toFixed(1)} min (${total} total)`
  );
}
console.log("finalize done");
