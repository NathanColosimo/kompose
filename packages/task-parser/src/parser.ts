import { Temporal } from "temporal-polyfill";
import { resolveFields, type TaskFields } from "./fields";
import {
  decodeSpans,
  encode,
  type LabelledSpan,
  viterbi,
} from "./model/features";
import { createNetwork } from "./model/network";
import { WordPiece } from "./model/tokenizer";
import { readWeights } from "./model/weights";

export interface TagOption<Id extends string = string> {
  id: Id;
  name: string;
}

export interface ParsedTask<Id extends string = string> extends TaskFields {
  /** Labelled character ranges of the input (UTF-16), for highlighting. */
  spans: LabelledSpan[];
  /** Chosen tags, most confident first. */
  tags: (TagOption<Id> & { confidence: number })[];
}

/** Tags at or above this probability are applied: a wrong tag costs more than a missing one (tuned on the test set). */
const DEFAULT_TAG_THRESHOLD = 0.8;

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

export interface ParseOptions<Id extends string = string> {
  now?: Temporal.ZonedDateTime;
  tags?: TagOption<Id>[];
}

/**
 * A parser over weights from training/model/export.py. A parse takes about
 * 5 ms on an M-series chip, nearly all of it the model (WebAssembly SIMD);
 * dates resolve in microseconds.
 */
export function createTaskParser(
  weightsFile: ArrayBuffer,
  { tagThreshold = DEFAULT_TAG_THRESHOLD }: { tagThreshold?: number } = {}
) {
  const weights = readWeights(weightsFile);
  const tokenizer = new WordPiece(weights.vocab);
  const forward = createNetwork(weights);

  return function parse<Id extends string>(
    text: string,
    { now = Temporal.Now.zonedDateTimeISO(), tags = [] }: ParseOptions<Id> = {}
  ): ParsedTask<Id> {
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
    const chosen = encoded.tagPositions
      .map((_, index) => {
        const tag = tags[index] as TagOption<Id>;
        return {
          ...tag,
          confidence: named.has(tagKey(tag.name))
            ? 1
            : 1 / (1 + Math.exp(-(logits.tags[index] as number))),
        };
      })
      .filter((tag) => tag.confidence >= tagThreshold)
      .sort((a, b) => b.confidence - a.confidence);
    const fields = resolveFields({
      now,
      spans,
      tagNames: chosen.map((tag) => tag.name),
      text,
    });
    return { ...fields, spans, tags: chosen };
  };
}

export type TaskParser = ReturnType<typeof createTaskParser>;
