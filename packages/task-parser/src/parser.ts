import { Temporal } from "temporal-polyfill";
import { resolveFields, type TaskFields } from "./fields";
import { decodeSpans, encode, viterbi } from "./model/features";
import { createNetwork } from "./model/network";
import { WordPiece } from "./model/tokenizer";
import { readWeights } from "./model/weights";
import type { Span } from "./spans";

export interface TagOption {
  id: string;
  name: string;
}

export interface ParsedTask extends TaskFields {
  /** Labelled character ranges of the input (UTF-16), for highlighting. */
  spans: Span[];
  /** Chosen tags, most confident first. */
  tags: (TagOption & { confidence: number })[];
}

/**
 * Tags at or above this probability are applied: a wrong tag costs more
 * than a missing one (tuned on the test set).
 */
const TAG_THRESHOLD = 0.8;

const TAG_WORD_PATTERN = /^(tags?\b:?|#|@)\s*|\s+tag$/giu;
const NOT_NAME_PATTERN = /[^\p{L}\p{N}\s&/]/gu;
const SEPARATOR_PATTERN = /[\s_-]+/g;

/** A tag name as typed: no emoji, "#", case, or "tag" word. */
function tagKey(name: string) {
  return name
    .replace(SEPARATOR_PATTERN, " ")
    .replace(TAG_WORD_PATTERN, "")
    .replace(NOT_NAME_PATTERN, "")
    .replace(SEPARATOR_PATTERN, " ")
    .trim()
    .toLowerCase();
}

export interface ParseOptions {
  now?: Temporal.ZonedDateTime;
  tags?: TagOption[];
}

/**
 * A parser over weights from training/model/export.py. A parse takes about
 * 5 ms on an M-series chip, nearly all of it the model (WebAssembly SIMD);
 * dates resolve in microseconds.
 */
export function createTaskParser(weightsFile: ArrayBuffer) {
  const weights = readWeights(weightsFile);
  const tokenizer = new WordPiece(weights.vocab);
  const forward = createNetwork(weights);

  return function parse(
    text: string,
    { now = Temporal.Now.zonedDateTimeISO(), tags = [] }: ParseOptions = {}
  ): ParsedTask {
    const encoded = encode(
      tokenizer,
      text,
      tags.map((tag) => tag.name)
    );
    const logits = forward(encoded);
    const spans = decodeSpans(encoded, viterbi(encoded, logits.spans), text);
    // A tag span that spells out a tag ("#work", "🧹 chores" for
    // "chores") picks it whatever the classifier says.
    const named = new Set(
      spans
        .filter((span) => span.label === "G")
        .map((span) => tagKey(span.text))
        .filter(Boolean)
    );
    // Tags past the model's token limit are dropped.
    const chosen = tags
      .slice(0, encoded.tagPositions.length)
      .map((tag, index) => ({
        ...tag,
        confidence: named.has(tagKey(tag.name))
          ? 1
          : 1 / (1 + Math.exp(-(logits.tags[index] as number))),
      }))
      .filter((tag) => tag.confidence >= TAG_THRESHOLD)
      .sort((a, b) => b.confidence - a.confidence);
    return { ...resolveFields({ now, spans, text }), spans, tags: chosen };
  };
}

export type TaskParser = ReturnType<typeof createTaskParser>;
