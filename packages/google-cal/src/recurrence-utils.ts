import { Temporal } from "temporal-polyfill";
import type { CreateEvent, Event } from "./schema";

const UNTIL_REGEX = /;?UNTIL=[^;]+/;
const COUNT_REGEX = /;?COUNT=([^;]+)/;
const COUNT_PART = /([:;])COUNT=[^;]+/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The series' rule cut to end just before the occurrence that started at
 * `originalStart` (a "2026-11-10" date for an all-day series, a date-time
 * otherwise): the day before as a date for an all-day series (UNTIL takes
 * its start's form), the second before otherwise. COUNT goes; UNTIL
 * replaces it.
 */
export function truncateRecurrenceForFollowing(
  recurrence: string[],
  originalStart: string
): string[] {
  const until = DATE_ONLY.test(originalStart)
    ? Temporal.PlainDate.from(originalStart)
        .subtract({ days: 1 })
        .toString()
        .replace(/-/g, "")
    : `${Temporal.Instant.from(originalStart)
        .subtract({ seconds: 1 })
        .toString()
        .slice(0, 19)
        .replace(/[-:]/g, "")}Z`;
  return recurrence.map((line) =>
    line.startsWith("RRULE:")
      ? `${line.replace(COUNT_REGEX, "").replace(UNTIL_REGEX, "")};UNTIL=${until}`
      : line
  );
}

/**
 * The rule for a series' following part when it keeps the series' COUNT:
 * what's left of it after the `used` occurrences before the split, so a
 * five-time series split at its third doesn't run five more times.
 */
export function withRemainingCount(
  recurrence: string[],
  used: number
): string[] {
  return recurrence.map((line) => {
    const count = line.startsWith("RRULE:")
      ? Number(COUNT_REGEX.exec(line)?.[1])
      : Number.NaN;
    return Number.isFinite(count)
      ? line.replace(
          COUNT_PART,
          `$1COUNT=${Math.max(1, count - used)}`
        )
      : line;
  });
}

/** Whether a series' rule ends after a number of times. */
export function hasCount(recurrence: string[]): boolean {
  return recurrence.some(
    (line) => line.startsWith("RRULE:") && COUNT_REGEX.test(line)
  );
}

// Strip server-managed fields so create/update inputs stay valid.
export function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}
