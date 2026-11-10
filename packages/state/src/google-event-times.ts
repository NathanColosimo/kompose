import type { Event as GoogleEvent } from "@kompose/google-cal/schema";

/** A Google event's start or end, as it sends them. */
export type EventTime = GoogleEvent["start"];

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
  const { date: _date, dateTime: _dateTime, ...rest } = source ?? {};
  return { ...rest, ...edited };
}
