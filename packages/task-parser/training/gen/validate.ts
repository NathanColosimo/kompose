/**
 * Checks raw generations against the spec and writes clean examples.
 * Usage: bun gen/validate.ts <name>
 * Writes data/clean/<name>.jsonl and prints a report.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import { parseDuration } from "../../src/duration";
import { resolveFields } from "../../src/fields";
import { MarkupError, parseMarkup, type Span } from "../../src/spans";
import { resolveWhen } from "../../src/when";
import type { Slot } from "./plan";

const ROOT = new URL("../", import.meta.url).pathname;
const name = process.argv[2] ?? "train";
/** "raw" checks Luna's drafts; "final" checks Sol's labels. */
const source = process.argv[3] ?? "raw";
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

export interface CleanExample {
  flags: string[];
  id: string;
  spans: Span[];
  tagList: string[];
  tags: string[];
  text: string;
}

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
  if (!"SUMR".includes(span.label)) {
    const trailing = TRAILING_PUNCT.exec(text);
    if (trailing) {
      end -= trailing[0].length;
      text = text.slice(0, -trailing[0].length);
    }
    return { ...span, end, start, text };
  }
  const meridiem = MERIDIEM.exec(fullText.slice(end));
  if (meridiem && "SUR".includes(span.label)) {
    end += meridiem[0].length;
    text = fullText.slice(start, end);
  }
  for (;;) {
    const cue = span.label === "R" ? null : LEADING_CUE.exec(text);
    if (!cue) {
      break;
    }
    start += cue[0].length;
    text = text.slice(cue[0].length);
  }
  const trailing = TRAILING_PUNCT.exec(text);
  if (trailing) {
    end -= trailing[0].length;
    text = text.slice(0, -trailing[0].length);
  }
  return { ...span, end, start, text };
}

async function check(
  marked: string,
  tags: string[],
  tagList: string[]
): Promise<{ example?: Omit<CleanExample, "id">; reject?: string }> {
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
      !(await resolveWhen(span.text, { now }))
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
    const fields = await resolveFields({ now, spans, tagNames: [] });
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
  const dir = `${ROOT}data/${source}/${name}/`;
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const clean: CleanExample[] = [];
  const rejects: Record<string, number> = {};
  const flagCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const missing: Record<string, number> = {};
  const seenText = new Set<string>();
  const rejectLog: string[] = [];
  let total = 0;

  for (const file of files) {
    const parsedFile = JSON.parse(await readFile(dir + file, "utf8"));
    const entries: {
      marked: string;
      slotNumber: number;
      tagList: string[] | undefined;
      tags: string[];
      labels: string[];
    }[] =
      source === "final"
        ? (
            parsedFile.items as {
              marked: string;
              tagList: string[];
              tags: string[];
            }[]
          ).map((item, index) => ({
            labels: [],
            marked: item.marked,
            slotNumber: index + 1,
            tagList: item.tagList,
            tags: item.tags,
          }))
        : (
            parsedFile.output as {
              marked: string;
              slot: number;
              tags: string[];
            }[]
          ).map((item) => {
            const slot = (parsedFile.slots as Slot[])[item.slot - 1];
            return {
              labels: slot?.labels ?? [],
              marked: item.marked,
              slotNumber: item.slot,
              tagList: slot?.tags,
              tags: item.tags,
            };
          });
    for (const item of entries) {
      total += 1;
      const slot = item.tagList
        ? { labels: item.labels, tags: item.tagList }
        : undefined;
      if (!slot) {
        rejects["bad slot"] = (rejects["bad slot"] ?? 0) + 1;
        continue;
      }
      const result = await check(item.marked, item.tags, slot.tags);
      if (!result.example) {
        const reason = (result.reject ?? "").split(":")[0] ?? "";
        rejectLog.push(
          JSON.stringify({
            marked: item.marked,
            reason: result.reject,
            tagList: slot.tags,
            tags: item.tags,
          })
        );
        rejects[reason] = (rejects[reason] ?? 0) + 1;
        continue;
      }
      const key = result.example.text.toLowerCase();
      if (seenText.has(key)) {
        rejects.duplicate = (rejects.duplicate ?? 0) + 1;
        continue;
      }
      seenText.add(key);
      for (const flag of result.example.flags) {
        const kind = flag.split(":")[0] ?? "";
        flagCounts[kind] = (flagCounts[kind] ?? 0) + 1;
      }
      const labels = new Set(result.example.spans.map((span) => span.label));
      for (const label of labels) {
        labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      }
      for (const label of slot.labels) {
        if (!labels.has(label as Span["label"])) {
          missing[label] = (missing[label] ?? 0) + 1;
        }
      }
      clean.push({
        id: `${name}/${file.replace(".json", "")}/${item.slotNumber}`,
        ...result.example,
      });
    }
  }

  await mkdir(`${ROOT}data/clean`, { recursive: true });
  await writeFile(
    `${ROOT}data/clean/${name}${source === "final" ? ".final" : ""}.jsonl`,
    `${clean.map((example) => JSON.stringify(example)).join("\n")}\n`
  );
  await writeFile(
    `${ROOT}data/clean/${name}${source === "final" ? ".final" : ""}.rejects.jsonl`,
    `${rejectLog.join("\n")}\n`
  );
  const withTags = clean.filter((example) => example.tags.length > 0).length;
  console.log(
    JSON.stringify(
      {
        clean: clean.length,
        flagged: clean.filter((example) => example.flags.length > 0).length,
        flags: flagCounts,
        labels: labelCounts,
        missingRequired: missing,
        rejects,
        total,
        withTags,
      },
      null,
      1
    )
  );
}
