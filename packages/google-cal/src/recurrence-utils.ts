import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";
import type { CreateEvent, Event } from "./schema";
import {
  countedRuleMeetings,
  DATE_ONLY,
  dateValues,
  type RecurrenceValue,
  readRecurrenceValue,
  ruleClock,
  ruleTimeOf,
  untilMoment,
} from "./until";

const COUNT_PART = /([:;])COUNT=([^;]+)/;
const UNTIL_VALUE = /[:;]UNTIL=([^;]+)/;
const FREQ_VALUE = /FREQ=([A-Z]+)/;
const INTERVAL_VALUE = /INTERVAL=(\d+)/;
const BY_PART = /[:;]BY[A-Z]+=/;
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

/** The unit a sub-daily rule steps by. */
const SUB_DAILY_UNIT: Record<string, "hours" | "minutes" | "seconds"> = {
  HOURLY: "hours",
  MINUTELY: "minutes",
  SECONDLY: "seconds",
};

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
function skipKey(value: RecurrenceValue): string {
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

/** A value as a moment: its own, or its day's start in `seriesZone`. */
function valueMoment(
  value: RecurrenceValue,
  seriesZone: string
): Temporal.Instant {
  return (
    value.instant ??
    value.day.toZonedDateTime({ timeZone: seriesZone }).toInstant()
  );
}

function sameValue(a: RecurrenceValue, b: RecurrenceValue): boolean {
  return a.instant && b.instant
    ? Temporal.Instant.compare(a.instant, b.instant) === 0
    : Temporal.PlainDate.compare(a.day, b.day) === 0;
}

/**
 * Whether a plain hourly (minutely, secondly) rule, stepping from `first`,
 * meets at `slot`. Null with BY parts, or across a clock change (see
 * `subDailyEndsBefore`).
 */
function subDailyHasSlot(
  rule: string,
  step: "hours" | "minutes" | "seconds",
  first: RecurrenceValue,
  slot: RecurrenceValue,
  seriesZone: string
): boolean | null {
  if (!(first.instant && slot.instant) || BY_PART.test(rule)) {
    return null;
  }
  const change = first.instant
    .toZonedDateTimeISO(seriesZone)
    .getTimeZoneTransition("next");
  if (
    change &&
    Temporal.Instant.compare(change.toInstant(), slot.instant) <= 0
  ) {
    return null;
  }
  const interval = Number(INTERVAL_VALUE.exec(rule)?.[1] ?? 1) || 1;
  const steps = first.instant.until(slot.instant).total({ unit: step });
  if (steps < 0 || !Number.isInteger(steps / interval)) {
    return false;
  }
  const ended = ruleEndsBefore(rule, first, slot.instant, seriesZone);
  return ended === null ? null : !ended;
}

/**
 * Whether `rule`, repeating from `first`, meets at `slot`: on its day,
 * before its end, at its time. Google meets a rule once a day, at its one
 * BYHOUR / BYMINUTE or the start's time, and ignores a list there. Null
 * when that can't be told.
 */
function ruleHasSlot(
  rule: string,
  first: RecurrenceValue,
  slot: RecurrenceValue,
  seriesZone: string
): boolean | null {
  const step = SUB_DAILY_UNIT[FREQ_VALUE.exec(rule)?.[1] ?? ""];
  if (step) {
    return subDailyHasSlot(rule, step, first, slot, seriesZone);
  }
  const clock = (value: RecurrenceValue) =>
    value.instant?.toZonedDateTimeISO(seriesZone).toPlainTime();
  const firstClock = clock(first);
  const slotClock = clock(slot);
  if (
    firstClock &&
    slotClock &&
    Temporal.PlainTime.compare(ruleClock(rule, firstClock), slotClock) !== 0
  ) {
    return false;
  }
  const onDay = isRuleDay(rule, first.day, slot.day);
  if (onDay !== true) {
    return onDay;
  }
  const ended = ruleEndsBefore(
    rule,
    first,
    valueMoment(slot, seriesZone),
    seriesZone
  );
  return ended === null ? null : !ended;
}

/**
 * Whether the series has a meeting at `slot` (an original start): its
 * start, an added (RDATE) meeting, or a rule's, less EXDATE skips. Google
 * keeps an occurrence's own changes only while the series still has its
 * original slot. Null when that can't be told.
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
  // EXRULE isn't read, so whether it drops `slot` can't be told.
  if (recurrence.some((line) => line.startsWith("EXRULE"))) {
    return null;
  }
  const at = (values: RecurrenceValue[]) =>
    values.some((value) => sameValue(value, slot));
  const skipped = dateValues(recurrence, "EXDATE", seriesZone);
  if (at(skipped)) {
    return false;
  }
  if (
    sameValue(first, slot) ||
    at(dateValues(recurrence, "RDATE", seriesZone))
  ) {
    return true;
  }
  if (
    Temporal.Instant.compare(
      valueMoment(slot, seriesZone),
      valueMoment(first, seriesZone)
    ) < 0
  ) {
    return false;
  }
  let unknown = false;
  for (const rule of recurrence.filter(isRule)) {
    const meets = ruleHasSlot(rule, first, slot, seriesZone);
    if (meets) {
      return true;
    }
    unknown ||= meets === null;
  }
  return unknown ? null : false;
}

/**
 * Whether a plain hourly (minutely, secondly) COUNT rule ends before
 * `split`. Null with BY parts, or across a clock change: calendars step by
 * wall time or by elapsed time, and which can't be told.
 */
function subDailyEndsBefore(
  rule: string,
  step: "hours" | "minutes" | "seconds",
  first: RecurrenceValue,
  count: number,
  split: Temporal.Instant,
  seriesZone: string
): boolean | null {
  if (!first.instant || BY_PART.test(rule)) {
    return null;
  }
  const interval = Number(INTERVAL_VALUE.exec(rule)?.[1] ?? 1) || 1;
  const last = first.instant.add({ [step]: interval * (count - 1) });
  // Any clock change by the last meeting, even one undone later, makes the
  // wall-time and elapsed-time readings differ.
  const change = first.instant
    .toZonedDateTimeISO(seriesZone)
    .getTimeZoneTransition("next");
  if (change && Temporal.Instant.compare(change.toInstant(), last) <= 0) {
    return null;
  }
  return Temporal.Instant.compare(last, split) < 0;
}

/**
 * Whether `rule` ends before `split`: its UNTIL is earlier, or its last
 * COUNT meeting is, counted from the series' `first` start. Null when that
 * can't be told.
 */
function ruleEndsBefore(
  rule: string,
  first: RecurrenceValue,
  split: Temporal.Instant,
  seriesZone: string
): boolean | null {
  const until = UNTIL_VALUE.exec(rule)?.[1];
  if (until) {
    const end = untilMoment(until, seriesZone);
    return end ? Temporal.Instant.compare(end, split) < 0 : null;
  }
  const count = ruleCount(rule);
  if (count === null) {
    return false;
  }
  const step = SUB_DAILY_UNIT[FREQ_VALUE.exec(rule)?.[1] ?? ""];
  if (step) {
    return subDailyEndsBefore(rule, step, first, count, split, seriesZone);
  }
  const clock = first.instant?.toZonedDateTimeISO(seriesZone).toPlainTime();
  const time = clock ? ruleTimeOf(rule, clock) : null;
  // Counted meeting by meeting: a time the clocks skip isn't a meeting
  // (RFC 5545; see until.ts `existsOn`).
  if (clock && time) {
    const meetings = countedRuleMeetings({
      base: clock,
      count,
      from: first.day,
      rule,
      time,
      timeZone: seriesZone,
    });
    return meetings ? Math.max(...meetings) < split.epochMilliseconds : null;
  }
  const last = countedRuleDays(rule, first.day, count)?.at(-1);
  if (!last) {
    return null;
  }
  // Timed rules were counted meeting by meeting above: this one is all day.
  const lastAt = last.toZonedDateTime({ timeZone: seriesZone }).toInstant();
  return Temporal.Instant.compare(lastAt, split) < 0;
}

const isRule = (line: string) => line.startsWith("RRULE:");

/** A rule line's COUNT; null for a line that isn't a rule or has none. */
function ruleCount(line: string): number | null {
  const count = isRule(line) ? Number(COUNT_PART.exec(line)?.[2]) : Number.NaN;
  return Number.isFinite(count) ? count : null;
}

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
