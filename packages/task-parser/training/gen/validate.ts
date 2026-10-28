/**
 * Checks final labels against the spec and writes clean examples.
 * Usage: bun gen/validate.ts <name>
 * Reads data/final/<name>/, writes data/clean/<name>.final.jsonl (and the
 * rejected items to .final.rejects.jsonl) and prints a report.
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { parseDuration } from "../../src/duration";
import { resolveFields } from "../../src/fields";
import { MarkupError, parseMarkup, type Span } from "../../src/spans";
import { resolveWhen } from "../../src/when";
import { ROOT, writeJsonl } from "./common";

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

const LEADING_CUE =
  /^(by|due|due on|due by|before|for|on|at|starting|from|until|takes|about|around)\s+/i;
const TRAILING_PUNCT = /[\s.,;:!?]+$/;
const DETACHED_MARK = /[#@]\s?$/;
const LEADING_JUNK = /^[\s\-–—:;,.>•*)]+/;
const MERIDIEM = /^\s?(a\.m\.|p\.m\.|am|pm)\b/i;
const CONNECTORS = new Set(
  "a an the and or but so to for of on at in by with from due before after until till about around also then just maybe probably when if is it i me my we our you your this that this next please pls thx thanks ok okay hey um uh like".split(
    " "
  )
);
const LINK = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/**
 * Move cue words out of date and duration spans, punctuation off span edges,
 * and a following "am"/"pm" into a time span.
 */
export function tidy(span: Span, fullText: string): Span {
  let { start, end, text } = span;
  if (span.label === "L") {
    return span;
  }
  // "#"/"@" belong to a tag mention; pull a detached one in ("# work").
  if (span.label === "G") {
    const before = DETACHED_MARK.exec(fullText.slice(0, start));
    if (before) {
      start -= before[0].length;
      text = fullText.slice(start, end);
    }
  }
  const junk = LEADING_JUNK.exec(text);
  if (junk) {
    start += junk[0].length;
    text = text.slice(junk[0].length);
  }
  if ("SUMR".includes(span.label)) {
    const meridiem = MERIDIEM.exec(fullText.slice(end));
    if (meridiem && span.label !== "M") {
      end += meridiem[0].length;
      text = fullText.slice(start, end);
    }
    for (
      let cue = span.label === "R" ? null : LEADING_CUE.exec(text);
      cue;
      cue = LEADING_CUE.exec(text)
    ) {
      start += cue[0].length;
      text = text.slice(cue[0].length);
    }
  }
  const trailing = TRAILING_PUNCT.exec(text);
  if (trailing) {
    end -= trailing[0].length;
    text = text.slice(0, -trailing[0].length);
  }
  return { ...span, end, start, text };
}

function check(
  marked: string,
  tags: string[],
  tagList: string[]
): {
  example?: {
    flags: string[];
    spans: Span[];
    tagList: string[];
    tags: string[];
    text: string;
  };
  reject?: string;
} {
  let parsed: ReturnType<typeof parseMarkup>;
  try {
    parsed = parseMarkup(marked);
  } catch (error) {
    return {
      reject:
        error instanceof MarkupError ? `markup: ${error.message}` : "markup",
    };
  }
  const spans = parsed.spans
    .map((span) => tidy(span, parsed.text))
    .filter((span) => span.text.length > 0);
  // Long unlabelled stretches mean the generator skipped part of the task.
  let cursor = 0;
  for (const span of [
    ...spans,
    { end: parsed.text.length, start: parsed.text.length },
  ]) {
    const gap = parsed.text.slice(cursor, span.start).toLowerCase();
    const words = gap.match(/[\p{L}']+/gu) ?? [];
    if (words.filter((word) => !CONNECTORS.has(word)).length >= 4) {
      return { reject: `unlabelled: ${gap.trim()}` };
    }
    cursor = span.end;
  }
  const flags: string[] = [];
  if (!spans.some((span) => span.label === "T" || span.label === "L")) {
    return { reject: "no title" };
  }
  const exact = new Map(tagList.map((tag) => [tag.toLowerCase(), tag]));
  const fixedTags: string[] = [];
  for (const tag of tags) {
    const match = exact.get(tag.toLowerCase());
    if (!match) {
      return { reject: `tag not in list: ${tag}` };
    }
    fixedTags.push(match);
  }
  for (const span of spans) {
    if (
      (span.label === "S" || span.label === "U") &&
      !resolveWhen(span.text, { now })
    ) {
      flags.push(`unresolved-${span.label}: ${span.text}`);
    }
    if (span.label === "M" && parseDuration(span.text) === null) {
      flags.push(`unresolved-M: ${span.text}`);
    }
    if (
      span.label === "L" &&
      !LINK.test(span.text.replace(TRAILING_PUNCT, ""))
    ) {
      flags.push(`bad-L: ${span.text}`);
    }
  }
  if (spans.some((span) => span.label === "R")) {
    const fields = resolveFields({ now, spans, tagNames: [] });
    if (!fields.recurrence) {
      flags.push(
        `unresolved-R: ${spans
          .filter((span) => span.label === "R")
          .map((span) => span.text)
          .join(" ")}`
      );
    }
  }
  return {
    example: {
      flags,
      spans,
      tagList,
      tags: [...new Set(fixedTags)],
      text: parsed.text,
    },
  };
}

if (import.meta.main) {
  const name = process.argv[2] ?? "train";
  const dir = `${ROOT}data/final/${name}/`;
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const clean: object[] = [];
  const rejectLog: object[] = [];
  const rejects: Record<string, number> = {};
  const flagCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const seenText = new Set<string>();
  let flagged = 0;
  let total = 0;
  let withTags = 0;
  for (const file of files) {
    const { items } = JSON.parse(await readFile(dir + file, "utf8")) as {
      items: { marked: string; tagList: string[]; tags: string[] }[];
    };
    for (const [index, item] of items.entries()) {
      total += 1;
      const { example, reject = "" } = check(
        item.marked,
        item.tags,
        item.tagList
      );
      if (!example) {
        rejectLog.push({ ...item, reason: reject });
        const reason = reject.split(":")[0] ?? "";
        rejects[reason] = (rejects[reason] ?? 0) + 1;
        continue;
      }
      const key = example.text.toLowerCase();
      if (seenText.has(key)) {
        rejects.duplicate = (rejects.duplicate ?? 0) + 1;
        continue;
      }
      seenText.add(key);
      for (const flag of example.flags) {
        const kind = flag.split(":")[0] ?? "";
        flagCounts[kind] = (flagCounts[kind] ?? 0) + 1;
      }
      for (const label of new Set(example.spans.map((span) => span.label))) {
        labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      }
      flagged += example.flags.length > 0 ? 1 : 0;
      withTags += example.tags.length > 0 ? 1 : 0;
      clean.push({
        id: `${name}/${file.replace(".json", "")}/${index + 1}`,
        ...example,
      });
    }
  }
  await mkdir(`${ROOT}data/clean`, { recursive: true });
  await writeJsonl(`${ROOT}data/clean/${name}.final.jsonl`, clean);
  await writeJsonl(`${ROOT}data/clean/${name}.final.rejects.jsonl`, rejectLog);
  console.log(
    JSON.stringify(
      {
        clean: clean.length,
        flagged,
        flags: flagCounts,
        labels: labelCounts,
        rejects,
        total,
        withTags,
      },
      null,
      1
    )
  );
}
