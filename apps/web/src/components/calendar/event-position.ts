import type { ItemLayout } from "@kompose/state/collision-utils";
import type { Temporal } from "temporal-polyfill";
import { minutesFromMidnight } from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "./constants";

export function calculateEventPosition(
  startTime: Temporal.ZonedDateTime,
  durationMinutes: number
): { top: string; height: string } {
  const startHour = minutesFromMidnight(startTime) / 60;
  const durationHours = durationMinutes / 60;
  const top = startHour * PIXELS_PER_HOUR;
  const height = durationHours * PIXELS_PER_HOUR;

  return {
    // Minimum height matches a 15-minute slot (20px).
    height: `${Math.max(height, 20)}px`,
    top: `${top}px`,
  };
}

/** Pixels per indent level, so the items underneath keep an edge in view. */
const STACK_INDENT_PX = 12;
/** Deeper levels stop indenting, so a block never gets too narrow to read. */
const MAX_STACK_INDENT_LEVELS = 4;

/**
 * Left and width for a timed block from its collision layout: indent by its
 * level, split the rest of the column into its group's columns, and leave a
 * 2px gap each side.
 */
export function blockHorizontalStyle(
  layout: ItemLayout | undefined
): Pick<React.CSSProperties, "left" | "width"> {
  const columns = layout?.totalColumns ?? 1;
  const column = layout?.columnIndex ?? 0;
  const span = layout?.columnSpan ?? 1;
  const indent =
    Math.min(layout?.stackDepth ?? 0, MAX_STACK_INDENT_LEVELS) *
    STACK_INDENT_PX;
  const rest = `(100% - ${indent}px)`;
  return {
    left: `calc(${rest} * ${column / columns} + ${indent + 2}px)`,
    width: `calc(${rest} * ${span / columns} - 4px)`,
  };
}
