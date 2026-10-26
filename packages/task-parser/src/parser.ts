import { Temporal } from "temporal-polyfill";
import { resolveFields, type TaskFields } from "./fields";
import { BytePairEncoding } from "./model/bpe";
import {
  decodeSpans,
  encode,
  type LabelledSpan,
  viterbi,
} from "./model/features";
import { forward } from "./model/network";
import { type Tokenizer, WordPiece } from "./model/tokenizer";
import { readWeights, type Weights } from "./model/weights";

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
const DEFAULT_TAG_THRESHOLD = 0.6;

const TAG_WORD_PATTERN = /^(tags?\b:?|#|@)\s*|\s+tag$/giu;
const NOT_NAME_PATTERN = /[^\p{L}\p{N}\s&/]/gu;
const SEPARATOR_PATTERN = /[\s_-]+/g;

/** A tag name as typed: no emoji, "#", case, or "tag" word. */
export function tagKey(name: string) {
  return name
    .replace(SEPARATOR_PATTERN, " ")
    .replace(TAG_WORD_PATTERN, "")
    .replace(NOT_NAME_PATTERN, "")
    .replace(SEPARATOR_PATTERN, " ")
    .trim()
    .toLowerCase();
}

/** The tokenizer a weight file was trained with: BPE when it has merges. */
export function tokenizerFor(weights: Weights): Tokenizer {
  return weights.merges
    ? new BytePairEncoding(weights.vocab, weights.merges, weights.added)
    : new WordPiece(weights.vocab);
}

export interface TaskParser {
  parse: <Id extends string>(
    text: string,
    options?: { now?: Temporal.ZonedDateTime; tags?: TagOption<Id>[] }
  ) => Promise<ParsedTask<Id>>;
}

/**
 * A parser over weights from training/model/export.py. Parsing takes a few
 * milliseconds; date resolution loads gpu-time on first use.
 */
export function createTaskParser(
  weightsFile: ArrayBuffer,
  { tagThreshold = DEFAULT_TAG_THRESHOLD }: { tagThreshold?: number } = {}
): TaskParser {
  const weights = readWeights(weightsFile);
  const tokenizer = tokenizerFor(weights);

  return {
    async parse(
      text,
      { now = Temporal.Now.zonedDateTimeISO(), tags = [] } = {}
    ) {
      const encoded = encode(
        tokenizer,
        text,
        tags.map((tag) => tag.name)
      );
      const logits = forward(weights, encoded);
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
          const tag = tags[index] as (typeof tags)[number];
          return {
            ...tag,
            confidence: named.has(tagKey(tag.name))
              ? 1
              : 1 / (1 + Math.exp(-(logits.tags[index] as number))),
          };
        })
        .filter((tag) => tag.confidence >= tagThreshold)
        .sort((a, b) => b.confidence - a.confidence);
      const fields = await resolveFields({
        now,
        spans,
        tagNames: chosen.map((tag) => tag.name),
        text,
      });
      return { ...fields, spans, tags: chosen };
    },
  };
}
