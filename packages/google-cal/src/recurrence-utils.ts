import type { CreateEvent, Event } from "./schema";

const STRIP_TIME_SEPARATORS = /[-:]/g;
const STRIP_MILLIS_SUFFIX = /\.\d{3}Z$/;
const UNTIL_REGEX = /;?UNTIL=[^;]+/;
const COUNT_REGEX = /;?COUNT=[^;]+/;

export function truncateRecurrenceForFollowing(
  recurrence: string[],
  occurrenceStart: Date,
  allDay: boolean
): string[] {
  const baseRule = recurrence[0];
  if (!baseRule) {
    return recurrence;
  }

  const untilDate = new Date(occurrenceStart);
  if (allDay) {
    untilDate.setDate(untilDate.getDate() - 1);
    untilDate.setHours(0, 0, 0, 0);
  } else {
    untilDate.setSeconds(untilDate.getSeconds() - 1);
  }
  const untilIso = untilDate
    .toISOString()
    .replace(STRIP_TIME_SEPARATORS, "")
    .replace(STRIP_MILLIS_SUFFIX, "Z");

  // COUNT and UNTIL are mutually exclusive per RFC 5545 — strip COUNT before adding UNTIL.
  const withoutCountOrUntil = baseRule
    .replace(COUNT_REGEX, "")
    .replace(UNTIL_REGEX, "");
  const nextRule = `${withoutCountOrUntil};UNTIL=${untilIso}`;

  return [nextRule, ...recurrence.slice(1)];
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

type EventTime = { date?: string; dateTime?: string; timeZone?: string };

const DAY_MS = 86_400_000;

/** The date a start is written on ("2026-11-07"), in its own offset. */
function writtenDate(time: { date?: string | null; dateTime?: string | null }) {
  return time.date ?? time.dateTime?.slice(0, 10) ?? null;
}

function dateUtcMs(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Whole days from one start's written date to another's: how far an edit
 * moved an occurrence, so the whole series moves as far.
 */
export function daysBetweenStarts(
  from: { date?: string | null; dateTime?: string | null },
  to: { date?: string | null; dateTime?: string | null }
): number {
  const a = writtenDate(from);
  const b = writtenDate(to);
  return a && b ? Math.round((dateUtcMs(b) - dateUtcMs(a)) / DAY_MS) : 0;
}

/** `time` with its date moved `days` days, its time of day kept. */
export function shiftEventTime(time: EventTime, days: number): EventTime {
  if (days === 0) {
    return time;
  }
  const shift = (date: string) =>
    new Date(dateUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
  if (time.date) {
    return { ...time, date: shift(time.date) };
  }
  if (time.dateTime) {
    return {
      ...time,
      dateTime: `${shift(time.dateTime.slice(0, 10))}${time.dateTime.slice(10)}`,
    };
  }
  return time;
}

