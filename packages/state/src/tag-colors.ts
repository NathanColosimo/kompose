import type {
  TagColorName,
  TagSelect,
} from "@kompose/api/routers/tag/contract";

/**
 * Tag swatches: pastels at one OKLCH lightness and chroma (about 0.80 and
 * 0.075; butter and apricot a little lighter so they don't go muddy), so no
 * tag outshouts another. Calendar blocks blend the swatch into the page
 * background, the same way they draw Google colors, so one value works in
 * both themes.
 */
export const tagColors: Record<
  TagColorName,
  { label: string; swatch: string }
> = {
  rose: { label: "Rose", swatch: "#eca9b2" },
  coral: { label: "Coral", swatch: "#ebad97" },
  apricot: { label: "Apricot", swatch: "#e9bf8e" },
  butter: { label: "Butter", swatch: "#e6d997" },
  sage: { label: "Sage", swatch: "#abd1a3" },
  mint: { label: "Mint", swatch: "#99d7c0" },
  sky: { label: "Sky", swatch: "#92cae6" },
  periwinkle: { label: "Periwinkle", swatch: "#a9b8ec" },
  lavender: { label: "Lavender", swatch: "#c9b2e5" },
  mauve: { label: "Mauve", swatch: "#e0acc8" },
};

export function tagSwatch(color: TagColorName | null): string | undefined {
  return color ? tagColors[color].swatch : undefined;
}

/** A task's calendar color: that of its first tag that has one. */
export function taskTagSwatch(
  tags: Pick<TagSelect, "color">[]
): string | undefined {
  return tagSwatch(tags.find((tag) => tag.color)?.color ?? null);
}
