import type { TaskSelect } from "@kompose/db/schema/task";
import { Temporal } from "temporal-polyfill";

/**
 * Pure planning for a recurring series' rows: the pattern the part of a
 * series that outlives its master (or a split) carries. The task client
 * applies the plan to the database.
 */

/**
 * The pattern a series' next occurrence takes when its master is deleted
 * alone: the same rule, with a count of the occurrences actually left (an
 * earlier one may have been deleted, or moved), so "after N times" still
 * matches the rows.
 */
export function heirPattern(
  pattern: TaskSelect["recurrence"],
  remaining: number
): TaskSelect["recurrence"] {
  return pattern?.count ? { ...pattern, count: remaining } : pattern;
}

/** A pattern stopped before `boundary` (a count no longer applies). */
export function endedBefore(
  recurrence: NonNullable<TaskSelect["recurrence"]>,
  boundary: string,
  /** The last occurrence left before the boundary, if known. */
  lastDate?: string | null
): NonNullable<TaskSelect["recurrence"]> {
  const { count: _count, ...pattern } = recurrence;
  // The earliest of: the day before the boundary, the pattern's own end,
  // and its last remaining occurrence, so it never claims days it lacks.
  const ends = [
    Temporal.PlainDate.from(boundary).subtract({ days: 1 }).toString(),
    recurrence.until,
    lastDate,
  ].filter((date): date is string => Boolean(date));
  return { ...pattern, until: ends.sort()[0] };
}
