import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { keepsTimes, sameTime } from "@kompose/google-cal/series-edits";

/** A Google event's start or end, as it sends them. */
export type EventTime = GoogleEvent["start"];

/**
 * A start or end as Google writes it: a date (all day) or a date-time,
 * with the zone it's in.
 */
export interface StartTime {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
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
 * The server's `keepsTimes` and `sameTime` under the names the app layers
 * import; they move to `@kompose/google-cal/series-edits`, then these go.
 */
export const keepsEventTimes = keepsTimes;
export const sameEventTime = sameTime;
