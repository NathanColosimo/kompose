import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { tagSwatch } from "@kompose/state/tag-colors";
import { Icon } from "@/components/ui/icon";
import { mixColor } from "@/lib/color-mix";
import { useColorScheme } from "@/lib/color-scheme-context";
import { THEME } from "@/lib/theme";
import { tagIconMap } from "./tag-icon-map";

/** A tag's icon, drawn in the tag's color when it has one. */
export function TagGlyph({
  className,
  size,
  tag,
}: {
  className?: string;
  size?: number;
  tag: Pick<TagSelect, "color" | "icon">;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const IconComponent = tagIconMap[tag.icon];
  const swatch = tagSwatch(tag.color);
  if (!swatch) {
    return <Icon as={IconComponent} className={className} size={size} />;
  }
  // Same ink as the web (--tag-ink-mix): darkened on paper for contrast.
  const ink = isDarkColorScheme
    ? swatch
    : mixColor(swatch, THEME.light.foreground, 0.5);
  return <IconComponent color={ink} size={size ?? 14} />;
}
