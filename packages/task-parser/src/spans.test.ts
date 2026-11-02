import { describe, expect, test } from "bun:test";
import { MarkupError, parseMarkup, toMarkup } from "./spans";

describe("parseMarkup", () => {
  test("round-trips text and spans", () => {
    const marked =
      "[F:remind me to] [T:call mom] [S:tmrw at 4] for [M:30 min], [D:ask about passports]";
    const { spans, text } = parseMarkup(marked);
    expect(text).toBe(
      "remind me to call mom tmrw at 4 for 30 min, ask about passports"
    );
    expect(
      spans.map((span) => [span.label, text.slice(span.start, span.end)])
    ).toEqual([
      ["F", "remind me to"],
      ["T", "call mom"],
      ["S", "tmrw at 4"],
      ["M", "30 min"],
      ["D", "ask about passports"],
    ]);
    expect(toMarkup(text, spans)).toBe(marked);
  });

  test.each([
    "[X:bad label]",
    "[T:unclosed",
    "[T:nested [S:no]]",
    "stray ] bracket",
    "[T: padded]",
    "[T:]",
  ])("rejects %p", (marked) => {
    expect(() => parseMarkup(marked)).toThrow(MarkupError);
  });
});
