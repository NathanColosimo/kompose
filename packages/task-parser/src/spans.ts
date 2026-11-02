/**
 * Span labels; see training/SPEC.md. Words outside any span are dropped.
 */
const LABELS = ["T", "D", "S", "U", "R", "M", "L", "G", "F"] as const;
export type Label = (typeof LABELS)[number];

export interface Span {
  end: number;
  label: Label;
  start: number;
  text: string;
}

export class MarkupError extends Error {}

const LABEL_SET = new Set<string>(LABELS);

/**
 * Parse inline markup ("[F:remind me to] [T:call mom] [S:tmrw]") into the
 * plain text and its spans. Throws MarkupError on malformed markup.
 */
export function parseMarkup(marked: string): { spans: Span[]; text: string } {
  let text = "";
  const spans: Span[] = [];
  let index = 0;
  while (index < marked.length) {
    const char = marked[index];
    if (char === "]") {
      throw new MarkupError(`Unmatched "]" at ${index}`);
    }
    if (char !== "[") {
      text += char;
      index += 1;
      continue;
    }
    const label = marked[index + 1] ?? "";
    if (!LABEL_SET.has(label) || marked[index + 2] !== ":") {
      throw new MarkupError(`Bad span opening at ${index}`);
    }
    const close = marked.indexOf("]", index + 3);
    const inner = marked.slice(index + 3, close);
    if (close === -1 || inner.includes("[")) {
      throw new MarkupError(`Unclosed or nested span at ${index}`);
    }
    if (!inner.trim() || inner !== inner.trim()) {
      throw new MarkupError(`Empty or padded span "${inner}"`);
    }
    spans.push({
      end: text.length + inner.length,
      label: label as Label,
      start: text.length,
      text: inner,
    });
    text += inner;
    index = close + 1;
  }
  return { spans, text };
}

/** Inverse of parseMarkup. Spans must be sorted and not overlap. */
export function toMarkup(text: string, spans: Span[]): string {
  let result = "";
  let index = 0;
  for (const span of spans) {
    result += `${text.slice(index, span.start)}[${span.label}:${text.slice(span.start, span.end)}]`;
    index = span.end;
  }
  return result + text.slice(index);
}
