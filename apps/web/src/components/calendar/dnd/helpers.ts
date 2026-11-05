import { Temporal } from "temporal-polyfill";
import { clampZonedDateTime, getDayBoundsZoned } from "@/lib/temporal-utils";

export const MINUTES_STEP = 15;

export function clampResizeStart(
  target: Temporal.ZonedDateTime,
  originalStart: Temporal.ZonedDateTime,
  originalEnd: Temporal.ZonedDateTime
): Temporal.ZonedDateTime {
  const { dayStart } = getDayBoundsZoned(
    originalStart.toPlainDate(),
    originalStart.timeZoneId
  );
  const latestStart = originalEnd.subtract({ minutes: MINUTES_STEP });
  const clampedToDay = clampZonedDateTime(target, dayStart, originalEnd);
  return Temporal.ZonedDateTime.compare(clampedToDay, latestStart) > 0
    ? latestStart
    : clampedToDay;
}

export function clampResizeEnd(
  target: Temporal.ZonedDateTime,
  originalStart: Temporal.ZonedDateTime
): Temporal.ZonedDateTime {
  const { dayEnd } = getDayBoundsZoned(
    originalStart.toPlainDate(),
    originalStart.timeZoneId
  );
  const earliestEnd = originalStart.add({ minutes: MINUTES_STEP });
  return clampZonedDateTime(target, earliestEnd, dayEnd);
}

export function durationInMinutes(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  minimum: number = MINUTES_STEP
): number {
  const mins = end.since(start).total({ unit: "minutes" });
  return Math.max(minimum, Math.round(mins));
}
