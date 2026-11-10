const LONG_WORD = /\p{L}{6,}/gu;

/**
 * Allow a hyphenated break inside long words, keeping three letters on each
 * side, for titles in narrow calendar blocks. Without it, words the
 * browser's dictionary can't split ("Roadmap", "Vendor") break with no
 * hyphen ("Roadm / ap"), and iOS cuts them to an ellipsis ("Ro…").
 */
export function withSoftHyphens(text: string) {
  return text.replace(LONG_WORD, (word) => {
    const letters = Array.from(word);
    return letters
      .map((letter, i) =>
        i >= 3 && i <= letters.length - 3 ? `\u00AD${letter}` : letter
      )
      .join("");
  });
}
