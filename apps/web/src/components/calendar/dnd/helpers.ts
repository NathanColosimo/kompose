import { Temporal } from "temporal-polyfill";
import { clampZonedDateTime, getDayBoundsZoned } from "@/lib/temporal-utils";
import type { DragDirection } from "./types";

export const MINUTES_STEP = 15;

/** The day holding the edge being dragged; an end at midnight belongs to the day before. */
export function edgeDay(
  direction: DragDirection,
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): Temporal.PlainDate {
  return direction === "start"
    ? start.toPlainDate()
    : end.subtract({ nanoseconds: 1 }).toPlainDate();
}

/**
 * The item's times after dragging one edge to `target`, or null when the
 * target is on another day. The edge stays on its own day and keeps the item
 * at least 15 minutes long, so the end of an overnight item can be dragged
 * from its second day.
 */
export function resizedRange({
  direction,
  end,
  start,
  target,
}: {
  direction: DragDirection;
  end: Temporal.ZonedDateTime;
  start: Temporal.ZonedDateTime;
  target: Temporal.ZonedDateTime;
}): { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime } | null {
  const day = edgeDay(direction, start, end);
  // An end target at midnight (dropped on 11:45 PM) belongs to the day before.
  if (!edgeDay(direction, target, target).equals(day)) {
    return null;
  }
  const { dayEnd, dayStart } = getDayBoundsZoned(day, start.timeZoneId);
  if (direction === "start") {
    const latest = end.subtract({ minutes: MINUTES_STEP });
    const upper =
      Temporal.ZonedDateTime.compare(latest, dayEnd) < 0 ? latest : dayEnd;
    return { end, start: clampZonedDateTime(target, dayStart, upper) };
  }
  const from =
    Temporal.ZonedDateTime.compare(start, dayStart) > 0 ? start : dayStart;
  return {
    end: clampZonedDateTime(
      target,
      from.add({ minutes: MINUTES_STEP }),
      dayEnd
    ),
    start,
  };
}

/** The part of a range inside one day, for drawing it in that day's column. */
export function clipToDay(
  range: { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime },
  day: Temporal.PlainDate
): { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime } {
  const { dayEnd, dayStart } = getDayBoundsZoned(day, range.start.timeZoneId);
  return {
    end: clampZonedDateTime(range.end, dayStart, dayEnd),
    start: clampZonedDateTime(range.start, dayStart, dayEnd),
  };
}

export function durationInMinutes(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  minimum: number = MINUTES_STEP
): number {
  const mins = end.since(start).total({ unit: "minutes" });
  return Math.max(minimum, Math.round(mins));
}
