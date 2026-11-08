import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";

/** A Google event's start or end, as it sends them. */
export type EventTime = GoogleEvent["start"];

/** A start or end as Google writes it: a date (all day) or a date-time. */
export interface StartTime {
  date?: string | null;
  dateTime?: string | null;
}

const NO_TIME: EventTime = {};

/**
 * A Google event's start or end with the edited time, keeping the source's
 * other fields (its time zone) but not the date form it no longer has: an
 * occurrence made all day sends a date, not its old dateTime as well
 * (which would keep the series timed), and the reverse.
 */
export function withEditedTime(
  source: EventTime | undefined,
  edited: EventTime
): EventTime {
  const { date: _date, dateTime: _dateTime, ...rest } = source ?? NO_TIME;
  return { ...rest, ...edited };
}

/**
 * Whether two Google starts (or ends) are the same: the same date, or the
 * same moment however its offset is written. False when either is missing
 * or doesn't parse.
 */
export function sameEventTime(
  a: StartTime | undefined,
  b: StartTime | undefined
): boolean {
  if (!(a && b)) {
    return false;
  }
  if (a.date || b.date) {
    return a.date === b.date;
  }
  try {
    return Boolean(
      a.dateTime &&
        b.dateTime &&
        Temporal.Instant.compare(
          Temporal.Instant.from(a.dateTime),
          Temporal.Instant.from(b.dateTime)
        ) === 0
    );
  } catch {
    return false;
  }
}
