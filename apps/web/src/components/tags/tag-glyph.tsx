import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { tagSwatch } from "@kompose/state/tag-colors";
import { tagIconMap } from "./tag-icon-map";

/** A tag's icon, drawn in the tag's color when it has one. */
export function TagGlyph({
  className,
  tag,
}: {
  className?: string;
  tag: Pick<TagSelect, "color" | "icon">;
}) {
  const Icon = tagIconMap[tag.icon];
  const swatch = tagSwatch(tag.color);
  return (
    <Icon
      aria-hidden
      className={className}
      // Inline, so the tint wins over the caller's muted text class.
      style={
        swatch
          ? {
              color: `color-mix(in oklab, ${swatch} var(--tag-ink-mix), var(--foreground))`,
            }
          : undefined
      }
    />
  );
}
