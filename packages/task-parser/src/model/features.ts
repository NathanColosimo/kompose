/**
 * Model inputs for (text, tag list). Mirrors training/model/features.py;
 * src/model/features.parity.test.ts checks the two produce the same inputs.
 */
import type { WordPiece } from "./tokenizer";

export const LABELS = ["T", "D", "S", "U", "R", "M", "G", "F"] as const;
export const TAG_NAMES = [
  "O",
  ...LABELS.flatMap((label) => [`B-${label}`, `I-${label}`]),
];
/** Special token ids: [PAD] 0, [CLS] 1, [SEP] 2, [URL] 3, [TAG] 4. */
const CLS = 1;
const SEP = 2;
const URL = 3;
const TAG = 4;
const SHAPES = [
  "special",
  "lower",
  "title",
  "upper",
  "digit",
  "mixed",
  "punct",
  "other",
] as const;

const MAX_TEXT_TOKENS = 128;
const MAX_TOKENS = 256;
const MAX_TAG_PIECES = 8;

const TLDS =
  "com|org|net|io|dev|so|co|app|ai|me|ly|gg|tv|edu|gov|us|uk|ca|de|fr|jp|au|xyz|info|biz|link|page|site|tech|example|cloud|email|fm|to|sh|is|it|nz|in";
const URL_CHAR = '[^ \\t\\n\\r\\f\\v<>"]';
const LINK_PATTERN = new RegExp(
  `(?:https?://|www\\.)${URL_CHAR}+|\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?:/${URL_CHAR}*)?`,
  "gi"
);
const TRAILING_LINK_PUNCT = /[.,;:!?)\]'"]+$/;
const WHITESPACE = /^\s$/;
const DIGIT = /^\p{Nd}$/u;
const LETTER = /^\p{L}$/u;
const UPPER = /^\p{Lu}$/u;
const PUNCT_OR_SYMBOL = /^[\p{P}\p{S}]$/u;
const WORD = /[\p{L}\p{N}_]{2,}/gu;

export interface Encoded {
  ids: number[];
  links: [number, number][];
  /** UTF-16 range in the text, or [-1, -1] for specials and tag tokens. */
  offsets: [number, number][];
  overlap: number[];
  segments: number[];
  shapes: number[];
  spaced: number[];
  specials: number[];
  tagPositions: number[];
}

function findLinks(text: string): [number, number][] {
  const links: [number, number][] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index;
    // An email's domain isn't a link.
    if (text[start - 1] !== "@") {
      const link = match[0].replace(TRAILING_LINK_PUNCT, "");
      links.push([start, start + link.length]);
    }
  }
  return links;
}

function shape(word: string): number {
  const chars = [...word];
  if (chars.length === 0) {
    return SHAPES.indexOf("other");
  }
  if (chars.some((char) => DIGIT.test(char))) {
    return SHAPES.indexOf(
      chars.every((char) => DIGIT.test(char)) ? "digit" : "mixed"
    );
  }
  const letters = chars.filter((char) => LETTER.test(char));
  if (letters.length === 0) {
    return SHAPES.indexOf(
      chars.every((char) => PUNCT_OR_SYMBOL.test(char)) ? "punct" : "other"
    );
  }
  if (letters.every((char) => UPPER.test(char))) {
    return SHAPES.indexOf(letters.length > 1 ? "upper" : "title");
  }
  return SHAPES.indexOf(UPPER.test(letters[0] ?? "") ? "title" : "lower");
}

/** Lowercased words of 2+ characters (letters, numbers, underscore). */
function wordsOf(text: string) {
  return new Set(text.match(WORD)?.map((word) => word.toLowerCase()));
}

/**
 * Model inputs for a text and the user's tags, appended after the text.
 * Mirrors `Featurizer.encode` in training/model/features.py.
 */
export function encode(
  tokenizer: WordPiece,
  text: string,
  tagList: string[]
): Encoded {
  const out: Encoded = {
    ids: [],
    links: findLinks(text),
    offsets: [],
    overlap: [],
    segments: [],
    shapes: [],
    spaced: [],
    specials: [],
    tagPositions: [],
  };
  const tagWords = wordsOf(tagList.join(" "));
  const textWords = wordsOf(text.replace(LINK_PATTERN, " "));

  /** One token of `source` (the text, segment 0, or a tag, segment 1). */
  const add = (
    id: number,
    special: number,
    start: number,
    end: number,
    segment: number,
    source: string
  ) => {
    const word = start >= 0 ? source.slice(start, end) : "";
    out.ids.push(id);
    out.specials.push(special);
    out.shapes.push(special ? SHAPES.indexOf("special") : shape(word));
    out.segments.push(segment);
    out.spaced.push(
      start > 0 && WHITESPACE.test(source[start - 1] ?? "") ? 1 : 0
    );
    out.overlap.push(
      (segment === 0 ? tagWords : textWords).has(word.toLowerCase()) ? 1 : 0
    );
    out.offsets.push(segment === 0 ? [start, end] : [-1, -1]);
  };

  add(-1, CLS, -1, -1, 0, text);
  let cursor = 0;
  let count = 0;
  for (const [linkStart, linkEnd] of [
    ...out.links,
    [text.length, text.length] as [number, number],
  ]) {
    for (const piece of tokenizer.encode(text.slice(cursor, linkStart))) {
      if (count < MAX_TEXT_TOKENS) {
        add(piece.id, 0, piece.start + cursor, piece.end + cursor, 0, text);
        count += 1;
      }
    }
    if (linkStart < linkEnd && count < MAX_TEXT_TOKENS) {
      add(-1, URL, linkStart, linkEnd, 0, text);
      count += 1;
    }
    cursor = linkEnd;
  }
  add(-1, SEP, -1, -1, 0, text);
  // Each tag: [TAG] and its word pieces.
  for (const tag of tagList) {
    if (out.ids.length >= MAX_TOKENS - 1) {
      break;
    }
    out.tagPositions.push(out.ids.length);
    add(-1, TAG, -1, -1, 1, tag);
    for (const piece of tokenizer.encode(tag).slice(0, MAX_TAG_PIECES)) {
      if (out.ids.length >= MAX_TOKENS) {
        break;
      }
      add(piece.id, 0, piece.start, piece.end, 1, tag);
    }
  }
  return out;
}

/** BIO: an I-X tag only continues a B-X or I-X. */
function allowed(previous: number, current: number) {
  const name = TAG_NAMES[current] ?? "O";
  return (
    !name.startsWith("I-") ||
    (previous > 0 && TAG_NAMES[previous]?.slice(2) === name.slice(2))
  );
}

/**
 * The best valid BIO sequence over the text tokens, from per-token logits
 * ([tokens, TAG_NAMES.length]). Specials, links and tag tokens come back O.
 * Mirrors `viterbi` in training/model/features.py.
 */
export function viterbi(encoded: Encoded, logits: Float32Array): number[] {
  const count = TAG_NAMES.length;
  const result = encoded.ids.map(() => 0);
  const positions = encoded.offsets.flatMap(([start], index) =>
    start >= 0 && encoded.specials[index] !== URL ? [index] : []
  );
  const logProbs = (token: number) => {
    const row = logits.subarray(token * count, (token + 1) * count);
    const max = Math.max(...row);
    let total = 0;
    for (const value of row) {
      total += Math.exp(value - max);
    }
    const log = max + Math.log(total);
    return Array.from(row, (value) => value - log);
  };
  // From a virtual O before the first token.
  let best = TAG_NAMES.map((_, tag) =>
    tag === 0 ? 0 : Number.NEGATIVE_INFINITY
  );
  const back: number[][] = [];
  for (const position of positions) {
    const row = logProbs(position);
    const pointers: number[] = [];
    best = row.map((score, tag) => {
      let choice = 0;
      let value = Number.NEGATIVE_INFINITY;
      best.forEach((previous, from) => {
        if (previous > value && allowed(from, tag)) {
          choice = from;
          value = previous;
        }
      });
      pointers.push(choice);
      return value + score;
    });
    back.push(pointers);
  }
  let last = best.indexOf(Math.max(...best));
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    result[positions[index] as number] = last;
    last = back[index]?.[last] ?? 0;
  }
  return result;
}

export interface LabelledSpan {
  end: number;
  label: (typeof LABELS)[number] | "L";
  start: number;
  text: string;
}

/** Merge per-token BIO predictions into spans of `text`, plus links. */
export function decodeSpans(
  encoded: Encoded,
  predictions: number[],
  text: string
): LabelledSpan[] {
  const spans: LabelledSpan[] = [];
  let lastToken = -1;
  encoded.offsets.forEach(([start, end], index) => {
    const tag = predictions[index] ?? 0;
    if (start < 0 || encoded.specials[index] === URL || tag === 0) {
      return;
    }
    const [prefix, label] = (TAG_NAMES[tag] ?? "O").split("-") as [
      string,
      LabelledSpan["label"],
    ];
    const last = spans.at(-1);
    const continuing =
      last !== undefined &&
      last.label === label &&
      lastToken === index - 1 &&
      (prefix === "I" || (start === last.end && !encoded.spaced[index]));
    if (continuing) {
      last.end = end;
      last.text = text.slice(last.start, end);
    } else {
      spans.push({ end, label, start, text: text.slice(start, end) });
    }
    lastToken = index;
  });
  for (const [start, end] of encoded.links) {
    spans.push({ end, label: "L", start, text: text.slice(start, end) });
  }
  return spans.sort((a, b) => a.start - b.start);
}
