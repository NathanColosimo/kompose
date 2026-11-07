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

/**
 * Pixels per indent level: the edge and color bar of the item underneath
 * stay in view, and its text (10px in from its edge) stays covered.
 */
const STACK_INDENT_PX = 9;
/** Deeper levels stop indenting, so a block never gets too narrow to read. */
const MAX_STACK_INDENT_LEVELS = 4;

/**
 * Left and width for a timed block from its collision layout: indent by its
 * level, then split the rest of the column into its group's columns.
 */
/**
 * A block's stacking order as a CSS variable, so hover and an open popover
 * can raise it (see BLOCK_RAISE_CLASS).
 */
export function blockStackStyle(zIndex: number | undefined) {
  return { "--block-z": zIndex ?? 1 } as React.CSSProperties;
}

/**
 * Raises a block above its stack after a short hover, and while its popover
 * is open, so an item underneath can show its end and resize handles.
 */
export const BLOCK_RAISE_CLASS =
  "z-(--block-z) [transition:box-shadow_150ms,z-index_0s_200ms] hover:z-50 data-[state=open]:z-50";

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
  // A 1px gap each side; the block's own 2px background ring fills the
  // rest, so nothing underneath shows between side-by-side blocks.
  return {
    left: `calc(${rest} * ${column / columns} + ${indent + 1}px)`,
    width: `calc(${rest} * ${span / columns} - 2px)`,
  };
}
