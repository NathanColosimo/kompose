import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { startInstant } from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";

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
 * Whether two Google starts (or ends) are the same, as the server's
 * `sameTime` reads them: one date, or one moment (a date-time without an
 * offset read in its own zone, else `timeZone`). False when either is
 * missing or doesn't parse.
 */
export function sameEventTime(
  a: StartTime | undefined,
  b: StartTime | undefined,
  timeZone: string
): boolean {
  if (!(a && b)) {
    return false;
  }
  if (a.date || b.date) {
    return a.date === b.date;
  }
  const from = startInstant(a, timeZone);
  const to = startInstant(b, timeZone);
  return Boolean(from && to && Temporal.Instant.compare(from, to) === 0);
}

/**
 * Whether an edit keeps an occurrence's start and end, as the server's
 * `keepsTimes` reads it: then a save for the series keeps its slot.
 */
export function keepsEventTimes(
  edited: { end: StartTime; start: StartTime },
  occurrence: { end: StartTime; start: StartTime },
  timeZone: string
): boolean {
  return (
    sameEventTime(edited.start, occurrence.start, timeZone) &&
    sameEventTime(edited.end, occurrence.end, timeZone)
  );
}
