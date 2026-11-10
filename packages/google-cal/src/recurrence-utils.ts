import { Temporal } from "temporal-polyfill";
import type { CreateEvent, Event } from "./schema";
import { ruleMeetsAt } from "./series";
import {
  DATE_ONLY,
  dateValues,
  type RecurrenceValue,
  readRecurrenceValue,
} from "./until";

const STRIP_TIME_SEPARATORS = /[-:]/g;
const STRIP_MILLIS_SUFFIX = /\.\d{3}Z$/;
const UNTIL_REGEX = /;?UNTIL=[^;]+/;
const COUNT_STRIP = /;?COUNT=[^;]+/;

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
    .replace(COUNT_STRIP, "")
    .replace(UNTIL_REGEX, "");
  const nextRule = `${withoutCountOrUntil};UNTIL=${untilIso}`;

  return [nextRule, ...recurrence.slice(1)];
}

/** A Google start ("2026-11-10" or a date-time) as a recurrence value. */
function asValue(start: string, seriesZone: string): RecurrenceValue | null {
  return readRecurrenceValue(start, seriesZone, seriesZone);
}

/** Whether `recurrence` repeats at all: a rule, or an added day. */
export function repeats(recurrence: string[] | undefined): boolean {
  return (recurrence ?? []).some(
    (line) => line.startsWith("RRULE:") || line.startsWith("RDATE")
  );
}

/** A skip's key: its moment, or its date for an all-day one. */
export function skipKey(value: RecurrenceValue): string {
  return value.instant
    ? String(value.instant.epochMilliseconds)
    : value.day.toString();
}

/**
 * `recurrence` with the occurrences at `starts` (original starts) skipped,
 * each once: a skip it already has isn't written again. Unchanged when it
 * doesn't repeat.
 */
export function skipping(
  recurrence: string[],
  starts: string[],
  zone: string
): string[] {
  if (starts.length === 0 || !repeats(recurrence)) {
    return recurrence;
  }
  const skipped = new Set(dateValues(recurrence, "EXDATE", zone).map(skipKey));
  // Each skip once, however many times it's asked for.
  const fresh = starts.filter((start) => {
    const value = asValue(start, zone);
    if (!value || skipped.has(skipKey(value))) {
      return !value;
    }
    skipped.add(skipKey(value));
    return true;
  });
  if (fresh.length === 0) {
    return recurrence;
  }
  const dates = fresh
    .filter((start) => DATE_ONLY.test(start))
    .map((start) => start.replace(/-/g, ""));
  const times = fresh
    .filter((start) => !DATE_ONLY.test(start))
    .map((start) =>
      Temporal.Instant.from(start)
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")
    );
  return [
    ...recurrence,
    ...(dates.length > 0 ? [`EXDATE;VALUE=DATE:${dates.join(",")}`] : []),
    ...(times.length > 0 ? [`EXDATE:${times.join(",")}`] : []),
  ];
}

function sameValue(a: RecurrenceValue, b: RecurrenceValue): boolean {
  return a.instant && b.instant
    ? Temporal.Instant.compare(a.instant, b.instant) === 0
    : Temporal.PlainDate.compare(a.day, b.day) === 0;
}

/**
 * Whether the series has a meeting at `slot` (an original start): its
 * start, an added (RDATE) meeting, or a rule's, less EXDATE skips. Google
 * keeps an occurrence's own changes only while the series still has its
 * original slot. Null when that can't be told: an exclusion rule (EXRULE)
 * isn't read.
 */
export function seriesMeetsAt(params: {
  recurrence: string[];
  seriesZone: string;
  slot: string;
  start: { date?: string | null; dateTime?: string | null };
}): boolean | null {
  const { recurrence, seriesZone } = params;
  const first = asValue(
    params.start.dateTime ?? params.start.date ?? "",
    seriesZone
  );
  const slot = asValue(params.slot, seriesZone);
  if (!(first && slot)) {
    return null;
  }
  // Every meeting takes the start's form (a date, or a date-time).
  if (Boolean(first.instant) !== Boolean(slot.instant)) {
    return false;
  }
  if (recurrence.some((line) => line.startsWith("EXRULE"))) {
    return null;
  }
  const at = (values: RecurrenceValue[]) =>
    values.some((value) => sameValue(value, slot));
  if (at(dateValues(recurrence, "EXDATE", seriesZone))) {
    return false;
  }
  if (
    sameValue(first, slot) ||
    at(dateValues(recurrence, "RDATE", seriesZone))
  ) {
    return true;
  }
  const meets = recurrence.filter(isRule).map((rule) =>
    ruleMeetsAt({
      first: first.instant?.toZonedDateTimeISO(seriesZone) ?? first.day,
      rule,
      slot: slot.instant ?? slot.day,
    })
  );
  if (meets.includes(true)) {
    return true;
  }
  return meets.includes(null) ? null : false;
}

const isRule = (line: string) => line.startsWith("RRULE:");

// Strip server-managed fields so create/update inputs stay valid.
export function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    // A new event can't reuse it; an update doesn't need it.
    iCalUID: _iCalUID,
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}
