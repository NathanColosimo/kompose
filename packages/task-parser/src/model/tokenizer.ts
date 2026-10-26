/**
 * BERT-style WordPiece tokenizer matching Hugging Face `tokenizers` with
 * BertNormalizer (clean text, CJK spacing, lowercase + strip accents) and
 * BertPreTokenizer. Offsets are UTF-16 indices into the original text.
 * training/model/parity.py checks this against the Python tokenizer.
 */

export interface Piece {
  end: number;
  id: number;
  start: number;
}

const MAX_WORD_CHARS = 100;
const COMBINING_MARK = /\p{Mn}/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const WHITESPACE = /\s/u;
const PUNCTUATION = /\p{P}/u;

function isPunctuation(codePoint: number, char: string) {
  return (
    (codePoint >= 33 && codePoint <= 47) ||
    (codePoint >= 58 && codePoint <= 64) ||
    (codePoint >= 91 && codePoint <= 96) ||
    (codePoint >= 123 && codePoint <= 126) ||
    PUNCTUATION.test(char)
  );
}

function isChinese(cp: number) {
  return (
    (cp >= 0x4e_00 && cp <= 0x9f_ff) ||
    (cp >= 0x34_00 && cp <= 0x4d_bf) ||
    (cp >= 0x2_00_00 && cp <= 0x2_a6_df) ||
    (cp >= 0x2_a7_00 && cp <= 0x2_b7_3f) ||
    (cp >= 0x2_b7_40 && cp <= 0x2_b8_1f) ||
    (cp >= 0x2_b8_20 && cp <= 0x2_ce_af) ||
    (cp >= 0xf9_00 && cp <= 0xfa_ff) ||
    (cp >= 0x2_f8_00 && cp <= 0x2_fa_1f)
  );
}

/** A normalized character and the UTF-16 range it came from. */
interface Char {
  end: number;
  start: number;
  text: string;
}

/** Normalize like BertNormalizer, keeping each output char's source range. */
function normalize(text: string): Char[] {
  const chars: Char[] = [];
  let index = 0;
  for (const char of text) {
    const start = index;
    index += char.length;
    const cp = char.codePointAt(0) ?? 0;
    if (cp === 0 || cp === 0xff_fd) {
      continue;
    }
    if (char !== "\t" && char !== "\n" && char !== "\r" && CONTROL.test(char)) {
      continue;
    }
    if (WHITESPACE.test(char)) {
      chars.push({ end: index, start, text: " " });
      continue;
    }
    if (isChinese(cp)) {
      chars.push({ end: start, start, text: " " });
      chars.push({ end: index, start, text: char });
      chars.push({ end: index, start: index, text: " " });
      continue;
    }
    // Lowercase, then strip accents (NFD without combining marks).
    for (const part of char.toLowerCase().normalize("NFD")) {
      if (!COMBINING_MARK.test(part)) {
        chars.push({ end: index, start, text: part });
      }
    }
  }
  return chars;
}

/** Split into words on whitespace, with each punctuation char its own word. */
function preTokenize(chars: Char[]): Char[][] {
  const words: Char[][] = [];
  let current: Char[] = [];
  const flush = () => {
    if (current.length > 0) {
      words.push(current);
      current = [];
    }
  };
  for (const char of chars) {
    if (char.text === " ") {
      flush();
    } else if (isPunctuation(char.text.codePointAt(0) ?? 0, char.text)) {
      flush();
      words.push([char]);
    } else {
      current.push(char);
    }
  }
  flush();
  return words;
}

export class WordPiece {
  readonly #vocab: Map<string, number>;
  readonly #unk: number;

  constructor(vocab: string[]) {
    this.#vocab = new Map(vocab.map((token, id) => [token, id]));
    this.#unk = this.#vocab.get("[UNK]") ?? 1;
  }

  encode(text: string): Piece[] {
    const pieces: Piece[] = [];
    for (const word of preTokenize(normalize(text))) {
      pieces.push(...this.#word(word));
    }
    return pieces;
  }

  #word(word: Char[]): Piece[] {
    const start = word[0]?.start ?? 0;
    const end = word.at(-1)?.end ?? start;
    // Count code points, like the Rust implementation.
    if (
      word.reduce((sum, char) => sum + [...char.text].length, 0) >
      MAX_WORD_CHARS
    ) {
      return [{ end, id: this.#unk, start }];
    }
    const pieces: Piece[] = [];
    let from = 0;
    while (from < word.length) {
      let to = word.length;
      let id: number | undefined;
      while (to > from) {
        const text = word
          .slice(from, to)
          .map((char) => char.text)
          .join("");
        id = this.#vocab.get(from > 0 ? `##${text}` : text);
        if (id !== undefined) {
          break;
        }
        to -= 1;
      }
      if (id === undefined) {
        return [{ end, id: this.#unk, start }];
      }
      pieces.push({
        end: word[to - 1]?.end ?? end,
        id,
        start: word[from]?.start ?? start,
      });
      from = to;
    }
    return pieces;
  }
}
