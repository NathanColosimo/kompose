/**
 * Byte-level BPE tokenizer matching Hugging Face `tokenizers` with an NFC
 * normalizer and the GPT-2 ByteLevel pre-tokenizer (ModernBERT/Ettin).
 * Offsets are UTF-16 indices into the original text, with a token's leading
 * space left out ("Ġmom" points at "mom"), as training/model/features.py
 * does. bpe.parity.test.ts checks this against the Python tokenizer.
 */
import type { Piece, Tokenizer } from "./tokenizer";

/** GPT-2's pre-tokenizer: contractions, words, numbers, symbols, spaces. */
const PRE_TOKEN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
const SPACE = /\s/u;

/** GPT-2's byte → printable character table. */
function byteTable() {
  const printable: number[] = [];
  for (let b = 33; b <= 126; b += 1) {
    printable.push(b);
  }
  for (let b = 161; b <= 172; b += 1) {
    printable.push(b);
  }
  for (let b = 174; b <= 255; b += 1) {
    printable.push(b);
  }
  const table: string[] = [];
  let extra = 0;
  for (let b = 0; b < 256; b += 1) {
    if (printable.includes(b)) {
      table[b] = String.fromCharCode(b);
    } else {
      table[b] = String.fromCharCode(256 + extra);
      extra += 1;
    }
  }
  return table;
}

const BYTES = byteTable();
const encoder = new TextEncoder();

/**
 * NFC text and, for each of its UTF-16 positions (and one past the end),
 * the matching position in the original.
 */
function nfc(text: string) {
  const normalized = text.normalize("NFC");
  if (normalized === text) {
    return { map: null, normalized };
  }
  // Rare (decomposed accents): map by normalizing growing prefixes.
  const map: number[] = [];
  let original = 0;
  for (const char of text) {
    const before = text.slice(0, original).normalize("NFC").length;
    original += char.length;
    const after = text.slice(0, original).normalize("NFC").length;
    for (let i = before; i < after; i += 1) {
      map[i] ??= original - char.length;
    }
  }
  map[normalized.length] = text.length;
  return { map, normalized };
}

export class BytePairEncoding implements Tokenizer {
  readonly #vocab: Map<string, number>;
  readonly #ranks: Map<string, number>;
  readonly #cache = new Map<string, string[]>();
  /** Tokens matched whole before BPE (space runs, "[unused0]"), longest first. */
  readonly #added: string[];

  constructor(vocab: string[], merges: string[], added: string[] = []) {
    this.#vocab = new Map(vocab.map((token, id) => [token, id]));
    this.#ranks = new Map(merges.map((merge, rank) => [merge, rank]));
    this.#added = [...added].sort((a, b) => b.length - a.length);
  }

  encode(text: string): Piece[] {
    const { map, normalized } = nfc(text);
    const original = (at: number) => (map ? (map[at] ?? at) : at);
    const pieces: Piece[] = [];
    let segment = 0;
    let index = 0;
    while (index < normalized.length) {
      const added = this.#addedAt(normalized, index);
      if (added) {
        this.#encodeSegment(normalized, segment, index, original, pieces);
        const end = index + added.length;
        // A run of spaces points at nothing, like a token's leading space.
        const start = added.trim() ? index : end;
        pieces.push({
          end: original(end),
          id: this.#vocab.get(added) ?? 0,
          start: original(start),
        });
        index = end;
        segment = end;
      } else {
        index += 1;
      }
    }
    this.#encodeSegment(
      normalized,
      segment,
      normalized.length,
      original,
      pieces
    );
    return pieces;
  }

  #addedAt(text: string, index: number) {
    const first = text[index];
    if (first !== " " && first !== "[" && first !== "|" && first !== "<") {
      return null;
    }
    return this.#added.find((token) => text.startsWith(token, index)) ?? null;
  }

  /** BPE pieces of text[from, to) (no added tokens inside). */
  #encodeSegment(
    text: string,
    from: number,
    to: number,
    original: (index: number) => number,
    pieces: Piece[]
  ) {
    if (from >= to) {
      return;
    }
    for (const match of text.slice(from, to).matchAll(PRE_TOKEN)) {
      const base = from + (match.index ?? 0);
      for (const piece of this.#chunkPieces(match[0])) {
        pieces.push({
          end: original(base + piece.end),
          id: piece.id,
          start: original(base + piece.start),
        });
      }
    }
  }

  /** Tokens of one pre-token, with offsets into it. */
  #chunkPieces(chunk: string): Piece[] {
    // UTF-16 offset of each byte of the chunk's UTF-8 encoding.
    const bytes: number[] = [];
    const byteStart: number[] = [];
    let offset = 0;
    for (const char of chunk) {
      for (const byte of encoder.encode(char)) {
        bytes.push(byte);
        byteStart.push(offset);
      }
      offset += char.length;
    }
    const pieces: Piece[] = [];
    let byte = 0;
    for (const token of this.#merge(bytes.map((b) => BYTES[b]).join(""))) {
      const length = [...token].length;
      let start = byteStart[byte] ?? 0;
      const last = byteStart[byte + length - 1] ?? start;
      const end = last + ((chunk.codePointAt(last) ?? 0) > 0xff_ff ? 2 : 1);
      byte += length;
      while (start < end && SPACE.test(chunk[start] ?? "")) {
        start += 1;
      }
      pieces.push({ end, id: this.#vocab.get(token) ?? 0, start });
    }
    return pieces;
  }

  /** The BPE tokens of one pre-token, lowest-rank merges first. */
  #merge(word: string): string[] {
    const cached = this.#cache.get(word);
    if (cached) {
      return cached;
    }
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Number.POSITIVE_INFINITY;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const rank = this.#ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) {
        break;
      }
      const pair = `${parts[best]}${parts[best + 1]}`;
      // Merge every occurrence of the pair, left to right.
      const merged: string[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        if (
          i < parts.length - 1 &&
          `${parts[i]}${parts[i + 1]}` === pair &&
          this.#ranks.get(`${parts[i]} ${parts[i + 1]}`) === bestRank
        ) {
          merged.push(pair);
          i += 1;
        } else {
          merged.push(parts[i] as string);
        }
      }
      parts = merged;
    }
    if (this.#cache.size < 50_000) {
      this.#cache.set(word, parts);
    }
    return parts;
  }
}
