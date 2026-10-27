/**
 * Model inputs for (text, tag list). Mirrors training/model/features.py;
 * src/model/features.parity.test.ts checks the two produce the same inputs.
 */
import type { Tokenizer } from "./tokenizer";

export const LABELS = ["T", "D", "S", "U", "R", "M", "G", "F"] as const;
export const TAG_NAMES = [
  "O",
  ...LABELS.flatMap((label) => [`B-${label}`, `I-${label}`]),
];
export const SPECIALS = ["[PAD]", "[CLS]", "[SEP]", "[URL]", "[TAG]"] as const;
const [, CLS, SEP, URL, TAG] = [0, 1, 2, 3, 4] as const;
export const SHAPES = [
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
const WORD_CHAR = /^[\p{L}\p{N}_]$/u;

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
  /**
   * Late-tag models: each tag as its own sequence, independent of the text
   * (so its encoding can be cached by name).
   */
  tagSequences?: { encoded: Encoded; name: string }[];
}

/** Tags read by a late-tag model, at most. */
const MAX_LATE_TAGS = 64;

export function findLinks(text: string): [number, number][] {
  const links: [number, number][] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index;
    let end = start + match[0].length;
    const trailing = TRAILING_LINK_PUNCT.exec(match[0]);
    if (trailing) {
      end -= trailing[0].length;
    }
    if (start > 0 && text[start - 1] === "@") {
      continue;
    }
    links.push([start, end]);
  }
  return links;
}

export function shape(word: string): number {
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
export function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  let current: string[] = [];
  for (const char of [...text, " "]) {
    if (WORD_CHAR.test(char)) {
      current.push(char);
    } else {
      if (current.length > 1) {
        words.add(current.join("").toLowerCase());
      }
      current = [];
    }
  }
  return words;
}

function spacedBefore(source: string, start: number) {
  return start > 0 && WHITESPACE.test(source[start - 1] ?? "") ? 1 : 0;
}

/** A tag on its own for late-tag models: [TAG] and its word pieces. */
export function encodeTag(tokenizer: Tokenizer, tag: string): Encoded {
  const out: Encoded = {
    ids: [-1],
    links: [],
    offsets: [[-1, -1]],
    overlap: [0],
    segments: [1],
    shapes: [SHAPES.indexOf("special")],
    spaced: [0],
    specials: [TAG],
    tagPositions: [],
  };
  for (const piece of tokenizer.encode(tag).slice(0, MAX_TAG_PIECES)) {
    out.ids.push(piece.id);
    out.specials.push(0);
    out.shapes.push(shape(tag.slice(piece.start, piece.end)));
    out.segments.push(1);
    out.spaced.push(spacedBefore(tag, piece.start));
    out.overlap.push(0);
    out.offsets.push([-1, -1]);
  }
  return out;
}

/** The text alone (words still flagged when in a tag), tags separately. */
function encodeLate(
  tokenizer: Tokenizer,
  text: string,
  tagList: string[]
): Encoded {
  const out = encode(tokenizer, text, []);
  const tagWords = wordsOf(tagList.join(" "));
  out.offsets.forEach(([start, end], index) => {
    if (start >= 0 && !out.specials[index]) {
      out.overlap[index] = tagWords.has(text.slice(start, end).toLowerCase())
        ? 1
        : 0;
    }
  });
  out.tagSequences = tagList
    .slice(0, MAX_LATE_TAGS)
    .map((name) => ({ encoded: encodeTag(tokenizer, name), name }));
  out.tagPositions = out.tagSequences.map(() => 0);
  return out;
}

/**
 * Model inputs for a text and the user's tags: the tags appended after the
 * text, or (`late`) as separate sequences. Mirrors `Featurizer.encode` in
 * training/model/features.py.
 */
export function encode(
  tokenizer: Tokenizer,
  text: string,
  tagList: string[],
  { late = false }: { late?: boolean } = {}
): Encoded {
  if (late) {
    return encodeLate(tokenizer, text, tagList);
  }
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
    out.spaced.push(spacedBefore(source, start));
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
  appendTags(out, tokenizer, tagList, textWords);
  return out;
}

/** Each tag after the text: [TAG] and its word pieces, segment 1. */
function appendTags(
  out: Encoded,
  tokenizer: Tokenizer,
  tagList: string[],
  textWords: Set<string>
) {
  for (const tag of tagList) {
    if (out.ids.length >= MAX_TOKENS - 1) {
      break;
    }
    out.tagPositions.push(out.ids.length);
    out.ids.push(-1);
    out.specials.push(TAG);
    out.shapes.push(SHAPES.indexOf("special"));
    out.segments.push(1);
    out.spaced.push(0);
    out.overlap.push(0);
    out.offsets.push([-1, -1]);
    for (const piece of tokenizer.encode(tag).slice(0, MAX_TAG_PIECES)) {
      if (out.ids.length >= MAX_TOKENS) {
        break;
      }
      const word = tag.slice(piece.start, piece.end);
      out.ids.push(piece.id);
      out.specials.push(0);
      out.shapes.push(shape(word));
      out.segments.push(1);
      out.spaced.push(spacedBefore(tag, piece.start));
      out.overlap.push(textWords.has(word.toLowerCase()) ? 1 : 0);
      out.offsets.push([-1, -1]);
    }
  }
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
  const [first] = positions;
  if (first === undefined) {
    return result;
  }
  let best = logProbs(first).map((score, tag) =>
    allowed(0, tag) ? score : Number.NEGATIVE_INFINITY
  );
  const back: number[][] = [];
  for (const position of positions.slice(1)) {
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
    if (index > 0) {
      last = back[index - 1]?.[last] ?? 0;
    }
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
  const spans: (LabelledSpan & { lastToken: number })[] = [];
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
      last.lastToken === index - 1 &&
      (prefix === "I" || (start === last.end && !encoded.spaced[index]));
    if (continuing) {
      last.end = end;
      last.lastToken = index;
    } else {
      spans.push({ end, label, lastToken: index, start, text: "" });
    }
  });
  const result: LabelledSpan[] = spans.map(({ end, label, start }) => ({
    end,
    label,
    start,
    text: text.slice(start, end),
  }));
  for (const [start, end] of encoded.links) {
    result.push({ end, label: "L", start, text: text.slice(start, end) });
  }
  return result.sort((a, b) => a.start - b.start);
}
