import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";
import type { CreateEvent, Event } from "./schema";
import type { SeriesRefusal } from "./series-edits";
import {
  countedRuleMeetings,
  DATE_ONLY,
  dateValues,
  keepingDateValues,
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
/** The unit a sub-daily rule steps by. */
const SUB_DAILY_UNIT: Record<string, "hours" | "minutes" | "seconds"> = {
  HOURLY: "hours",
  MINUTELY: "minutes",
  SECONDLY: "seconds",
};

/**
 * The series' rule cut to end just before the occurrence at `originalStart`.
 * UNTIL replaces COUNT and takes the start's form (a date when all day).
 * A cut at or before the series' own start (RDATE meetings come before it)
 * skips that start too: Google keeps a series' start whatever its rule says.
 */
export function truncateRecurrenceForFollowing(
  recurrence: string[],
  originalStart: string,
  /** The series' zone, for the days of its RDATE values. */
  seriesZone: string,
  /** The series' first start, where a COUNT counts from. */
  seriesStart: string | undefined
): string[] {
  const split = asValue(originalStart, seriesZone);
  if (!split) {
    return recurrence;
  }
  const until = split.instant
    ? split.instant
        .subtract({ seconds: 1 })
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")
    : split.day.subtract({ days: 1 }).toString().replace(/-/g, "");
  const splitMoment = valueMoment(split, seriesZone);
  const firstValue = seriesStart ? asValue(seriesStart, seriesZone) : null;
  // A rule that ends before the split keeps its end (a cut never lengthens
  // it); one whose end can't be told is cut, so nothing runs past the
  // split. Beside other rules, though, the split may be another rule's
  // meeting after this one's COUNT ran out, and an UNTIL there would add
  // meetings it never had: such a rule keeps its COUNT, as on main, even
  // if it meets on past the split.
  const severalRules = recurrence.filter(isRule).length > 1;
  const keepsItsEnd = (line: string) => {
    const ended = ruleEndsBefore(line, firstValue, splitMoment, seriesZone);
    return (
      ended === true ||
      (ended === null && severalRules && ruleCount(line) !== null)
    );
  };
  const skippedStart =
    firstValue &&
    Temporal.Instant.compare(
      splitMoment,
      valueMoment(firstValue, seriesZone)
    ) <= 0
      ? (firstValue.instant?.toString() ?? firstValue.day.toString())
      : null;
  const cut = splitAddedDays(
    recurrence,
    originalStart,
    seriesZone,
    "before"
  ).map((line) => {
    if (!line.startsWith("RRULE:")) {
      return line;
    }
    if (keepsItsEnd(line)) {
      return line;
    }
    // Part by part, so "RRULE:COUNT=5;..." leaves no empty part behind.
    const parts = line
      .slice("RRULE:".length)
      .split(";")
      .filter(
        (part) =>
          part && !part.startsWith("COUNT=") && !part.startsWith("UNTIL=")
      );
    return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
  });
  return skippedStart ? skipping(cut, [skippedStart], seriesZone) : cut;
}

/**
 * The series' rule with its meetings from `originalStart` on deleted,
 * where a rule's end can't be worked out (`followingCutUnsure`), read
 * from `listed`, its meetings' original starts as Google lists them.
 * With one rule, a listed meeting from the split on that isn't an added
 * one is the rule's, so it runs past the split and is cut as usual.
 * Otherwise a rule whose end can't be told keeps it (cut, it could run
 * past its COUNT), the other rules are cut, the added days from the split
 * go, and each listed meeting there is skipped, as it may be that rule's.
 * Only for a series whose every rule ends (`followingDelete`).
 */
export function deleteFromListed(params: {
  listed: string[];
  originalStart: string;
  recurrence: string[];
  seriesStart?: string;
  seriesZone: string;
}): string[] {
  const { listed, originalStart, recurrence, seriesStart, seriesZone } = params;
  const fromSplit = listed.filter((start) => {
    const value = asValue(start, seriesZone);
    return value && !beforeSplit(value, originalStart, seriesZone);
  });
  const rules = recurrence.filter(isRule);
  if (
    rules.length === 1 &&
    fromSplit.some((start) => !addsSlot(recurrence, start, seriesZone))
  ) {
    return truncateRecurrenceForFollowing(
      recurrence,
      originalStart,
      seriesZone,
      seriesStart
    );
  }
  const first = seriesStart ? asValue(seriesStart, seriesZone) : null;
  const split = asValue(originalStart, seriesZone);
  const splitAt = split && valueMoment(split, seriesZone);
  const unsure = rules.filter(
    (rule) =>
      splitAt && ruleEndsBefore(rule, first, splitAt, seriesZone) === null
  );
  const cut = truncateRecurrenceForFollowing(
    recurrence.filter((line) => !unsure.includes(line)),
    originalStart,
    seriesZone,
    seriesStart
  );
  // A listed meeting no unsure rule meets is a cut rule's or a dropped
  // added day's, gone with them.
  const theirs = fromSplit.filter((start) => {
    const value = asValue(start, seriesZone);
    return (
      !(first && value) ||
      unsure.some(
        (rule) => ruleHasSlot(rule, first, value, seriesZone) !== false
      )
    );
  });
  return skipping([...unsure, ...cut], theirs, seriesZone);
}

/**
 * How "This and following" is deleted from `originalStart`: cut the rules
 * there (`truncateRecurrenceForFollowing`); or, where that could lengthen
 * a rule (`followingCutUnsure`), read the end from Google's list of the
 * series' meetings (`deleteFromListed`), which ends only when every rule
 * does. When one never ends, an added meeting's delete is refused (no
 * list says which meetings are the unsure rule's), and a rule meeting's is
 * cut as before.
 */
export function followingDelete(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): "cut" | "list" | "refuse" {
  const recurrence = params.masterRecurrence ?? [];
  if (!followingCutUnsure(params)) {
    return "cut";
  }
  if (
    recurrence
      .filter(isRule)
      .every((rule) => ruleCount(rule) !== null || UNTIL_VALUE.test(rule))
  ) {
    return "list";
  }
  return addsSlot(recurrence, params.originalStart, params.seriesZone)
    ? "refuse"
    : "cut";
}

/**
 * Whether a new series' rule ends (UNTIL) before `first`, its first
 * meeting: Google would keep only that meeting.
 */
export function endsBeforeStart(
  recurrence: string[],
  first: Temporal.Instant | null,
  seriesZone: string
): boolean {
  const until = recurrence.find(isRule)?.match(UNTIL_VALUE)?.[1];
  const last = until ? untilMoment(until, seriesZone) : null;
  return Boolean(last && first && Temporal.Instant.compare(last, first) < 0);
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
  const fresh = starts.filter((start) => {
    const value = asValue(start, zone);
    return !(value && skipped.has(skipKey(value)));
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

/**
 * The following part's rule with its COUNT less the `used` occurrences
 * before the split (a five-time series split at its third runs three).
 */
function withRemainingCount(recurrence: string[], used: number): string[] {
  return recurrence.map((line) => {
    const count = ruleCount(line);
    return count === null
      ? line
      : line.replace(COUNT_PART, `$1COUNT=${Math.max(1, count - used)}`);
  });
}

/** Whether a recurrence value comes before the split at `originalStart`. */
function beforeSplit(
  value: RecurrenceValue,
  originalStart: string,
  seriesZone: string
): boolean {
  if (DATE_ONLY.test(originalStart)) {
    return (
      Temporal.PlainDate.compare(
        value.day,
        Temporal.PlainDate.from(originalStart)
      ) < 0
    );
  }
  const split = Temporal.Instant.from(originalStart);
  return value.instant
    ? Temporal.Instant.compare(value.instant, split) < 0
    : Temporal.PlainDate.compare(
        value.day,
        split.toZonedDateTimeISO(seriesZone).toPlainDate()
      ) < 0;
}

/**
 * The recurrence keeping only the RDATE days on one side of the split
 * (`keep`). UNTIL doesn't cut added days, so each part takes its own.
 */
export function splitAddedDays(
  recurrence: string[],
  originalStart: string,
  seriesZone: string,
  keep: "before" | "from"
): string[] {
  return keepingDateValues(
    recurrence,
    "RDATE",
    seriesZone,
    (value) =>
      beforeSplit(value, originalStart, seriesZone) === (keep === "before")
  );
}

/** A Google start ("2026-11-10" or a date-time) as a recurrence value. */
function asValue(start: string, seriesZone: string): RecurrenceValue | null {
  return readRecurrenceValue(start, seriesZone, seriesZone);
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

/** The values, each moment (or day) once. */
function unique(values: RecurrenceValue[]): RecurrenceValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = skipKey(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sameValue(a: RecurrenceValue, b: RecurrenceValue): boolean {
  return a.instant && b.instant
    ? Temporal.Instant.compare(a.instant, b.instant) === 0
    : Temporal.PlainDate.compare(a.day, b.day) === 0;
}

/** Why a series can't be split at an occurrence ("This and following"). */
export type SplitBlock = Extract<
  SeriesRefusal["reason"],
  "addedOccurrence" | "severalRules"
>;

/**
 * Whether deleting from `originalStart` on could lengthen a rule: one whose
 * end can't be told would be cut there, which could run it past where it
 * really ended. That can happen at an added (RDATE) meeting, or, with
 * several rules, at another rule's meeting.
 */
function followingCutUnsure(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): boolean {
  const recurrence = params.masterRecurrence ?? [];
  const rules = recurrence.filter(isRule);
  const split = asValue(params.originalStart, params.seriesZone);
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    params.seriesZone
  );
  if (
    !split ||
    (rules.length < 2 &&
      !addsSlot(recurrence, params.originalStart, params.seriesZone))
  ) {
    return false;
  }
  const at = valueMoment(split, params.seriesZone);
  return rules.some(
    (rule) => ruleEndsBefore(rule, first, at, params.seriesZone) === null
  );
}

/**
 * Whether `slot` (an original start) is an added (RDATE) meeting. It may be
 * a rule meeting too; the caller decides whose it is.
 */
export function addsSlot(
  recurrence: string[],
  slot: string,
  seriesZone: string
): boolean {
  const value = asValue(slot, seriesZone);
  return Boolean(
    value &&
      dateValues(recurrence, "RDATE", seriesZone).some((added) =>
        sameValue(added, value)
      )
  );
}

/**
 * Whether "This and following" from `originalStart` is the whole series:
 * nothing of it comes before (it's at or before the series' start, with
 * no meeting added before it).
 */
export function followingIsWhole(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): boolean {
  const { seriesZone } = params;
  const at = asValue(params.originalStart, seriesZone);
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    seriesZone
  );
  if (!(at && first)) {
    return false;
  }
  const moment = valueMoment(at, seriesZone);
  return (
    Temporal.Instant.compare(moment, valueMoment(first, seriesZone)) <= 0 &&
    !dateValues(params.masterRecurrence ?? [], "RDATE", seriesZone).some(
      (added) =>
        Temporal.Instant.compare(valueMoment(added, seriesZone), moment) < 0
    )
  );
}

/**
 * Why "This and following" can't start a new series at `originalStart`;
 * null when it can. A new series repeats from its start, so that start
 * must be a rule meeting. Several rules (an EXRULE counts; only imported
 * calendars write them) can't keep each one's days and phase from one
 * start, nor can an added (RDATE) meeting that isn't a rule meeting too.
 */
export function followingSplitBlocked(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): SplitBlock | null {
  const recurrence = params.masterRecurrence ?? [];
  const rules = recurrence.filter(isRule);
  const exclusions = recurrence.filter((line) => line.startsWith("EXRULE"));
  if (rules.length + exclusions.length > 1) {
    return "severalRules";
  }
  const split = asValue(params.originalStart, params.seriesZone);
  if (
    !(split && addsSlot(recurrence, params.originalStart, params.seriesZone))
  ) {
    return null;
  }
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    params.seriesZone
  );
  const rule = rules[0];
  return rule &&
    first &&
    ruleHasSlot(rule, first, split, params.seriesZone) === true
    ? null
    : "addedOccurrence";
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
  first: RecurrenceValue | null,
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
  if (!first) {
    return null;
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
  const lastAt = last
    .toZonedDateTime({
      plainTime: time ?? clock ?? undefined,
      timeZone: seriesZone,
    })
    .toInstant();
  return Temporal.Instant.compare(lastAt, split) < 0;
}

/**
 * Whether `value` is from the series' start (a skip an earlier split left
 * before it isn't one of its meetings) up to the split.
 */
function fromStartToSplit(
  value: RecurrenceValue,
  params: { originalStart: string; seriesStart: string; seriesZone: string }
): boolean {
  const { originalStart, seriesStart, seriesZone } = params;
  return (
    !beforeSplit(value, seriesStart, seriesZone) &&
    beforeSplit(value, originalStart, seriesZone)
  );
}

/**
 * The following part's rule with the COUNT carried on, counted from
 * `starts` (Google's list of the series' meetings) when the rule can't be
 * walked (`carryCountExactly`). COUNT counts rule positions, skipped ones
 * included; Google lists the rule's meetings, cancelled ones too, and the
 * added (RDATE) ones, but not every skip. So the positions used before the
 * split are the meetings listed there. When those can't be told (an added
 * day there can't be told from a rule day, a skip there Google doesn't
 * list may or may not be a position, or a start at a time its rule doesn't
 * meet may or may not count), the positions left are counted from the
 * split on instead, the same way; null when neither side can be told.
 */
export function carryCountFromList(
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesZone: string;
    /** Every occurrence's original start, as Google lists them. */
    starts: string[];
    /** The series' own first start, where its rule counts from. */
    seriesStart: string;
  }
): string[] | null {
  const { masterRecurrence, originalStart, seriesZone } = params;
  const rule = masterRecurrence.find(isRule);
  const count = rule ? ruleCount(rule) : null;
  const start = asValue(params.seriesStart, seriesZone);
  if (!(rule && count !== null && start)) {
    return null;
  }
  const listed = unique(
    params.starts
      .map((value) => asValue(value, seriesZone))
      .filter((value): value is RecurrenceValue => value !== null)
  );
  const added = dateValues(masterRecurrence, "RDATE", seriesZone);
  const skipped = dateValues(masterRecurrence, "EXDATE", seriesZone);
  // The positions in a stretch of the series: what Google lists there, or
  // null when an added day or an unlisted skip falls in it.
  const positionsIn = (inStretch: (value: RecurrenceValue) => boolean) => {
    const there = listed.filter(inStretch);
    const unclear =
      added.filter(inStretch).length > 0 ||
      skipped
        .filter(inStretch)
        .some((skip) => !there.some((value) => sameValue(value, skip)));
    return unclear ? null : there.length;
  };
  const startClock = start.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  const startAtRuleTime =
    !startClock || ruleClock(rule, startClock).equals(startClock);
  const before = startAtRuleTime
    ? positionsIn((value) => fromStartToSplit(value, params))
    : null;
  if (before !== null) {
    return withRemainingCount(recurrence, before);
  }
  const left = positionsIn(
    (value) => !beforeSplit(value, originalStart, seriesZone)
  );
  return left === null || left === 0
    ? null
    : withRemainingCount(recurrence, count - left);
}

const isRule = (line: string) => line.startsWith("RRULE:");

/** A rule line's COUNT; null for a line that isn't a rule or has none. */
function ruleCount(line: string): number | null {
  const count = isRule(line) ? Number(COUNT_PART.exec(line)?.[2]) : Number.NaN;
  return Number.isFinite(count) ? count : null;
}

/**
 * How many of a COUNT `rule`'s positions (meetings, or days for an all-day
 * series) come before `split`. Google counts the series' start as its
 * first, rule day or not, when it's at the rule's time. Null when they
 * can't be told, a start at another time among them: whether Google counts
 * it isn't known, so Google's list decides (`carryCountFromList`).
 */
function positionsBefore(params: {
  rule: string;
  seriesStart: RecurrenceValue;
  seriesZone: string;
  split: RecurrenceValue;
}): number | null {
  const { rule, seriesStart, seriesZone, split } = params;
  const count = ruleCount(rule);
  if (count === null) {
    return null;
  }
  const seriesClock = seriesStart.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  if (seriesClock && seriesStart.instant && split.instant) {
    const clock = ruleClock(rule, seriesClock);
    if (!clock.equals(seriesClock)) {
      return null;
    }
    const meetings = countedRuleMeetings({
      base: seriesClock,
      count,
      from: seriesStart.day,
      rule,
      time: clock,
      timeZone: seriesZone,
    });
    if (
      !meetings ||
      skipsAClockGap({
        before: split.instant,
        clock,
        from: seriesStart.instant,
        meetings,
        rule,
        seriesZone,
      })
    ) {
      return null;
    }
    const at = split.instant.epochMilliseconds;
    return [...meetings].filter((ms) => ms < at).length;
  }
  return (
    countedRuleDays(rule, seriesStart.day, count)?.filter(
      (day) => Temporal.PlainDate.compare(day, split.day) < 0
    ).length ?? null
  );
}

/**
 * Whether a rule's counted `meetings` pass a rule day whose `clock` time
 * the clocks skip (2:30 AM on the spring-forward night). RFC 5545 drops
 * that meeting; Google's list shows what Google did, so the count is left
 * to it (see until.ts `existsOn`).
 */
function skipsAClockGap(params: {
  /** Only days before this count: a gap after it changes no position before. */
  before: Temporal.Instant;
  clock: Temporal.PlainTime;
  from: Temporal.Instant;
  meetings: Set<number>;
  rule: string;
  seriesZone: string;
}): boolean {
  const { before, clock, from, meetings, rule, seriesZone } = params;
  const start = from.toZonedDateTimeISO(seriesZone).toPlainDate();
  const last = Temporal.Instant.fromEpochMilliseconds(Math.max(...meetings))
    .toZonedDateTimeISO(seriesZone)
    .toPlainDate();
  for (
    let day = start;
    Temporal.PlainDate.compare(day, last) <= 0;
    day = day.add({ days: 1 })
  ) {
    const zoned = day.toZonedDateTime({
      plainTime: clock,
      timeZone: seriesZone,
    });
    if (
      Temporal.PlainTime.compare(zoned.toPlainTime(), clock) !== 0 &&
      Temporal.Instant.compare(zoned.toInstant(), from) >= 0 &&
      Temporal.Instant.compare(zoned.toInstant(), before) < 0 &&
      isRuleDay(rule, start, day) === true
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The following part's rule with exactly the positions it has left: its
 * COUNT less the positions before the split (skips included, added days
 * not). Null when the walk can't tell, or with several rules (such a
 * series can't be split).
 */
export function carryCountExactly(
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesStart: string;
    seriesZone: string;
  }
): string[] | null {
  const { masterRecurrence, originalStart, seriesZone } = params;
  const [rule, ...others] = masterRecurrence.filter(isRule);
  const seriesStart = asValue(params.seriesStart, seriesZone);
  const split = asValue(originalStart, seriesZone);
  if (!(rule && seriesStart && split) || others.length > 0) {
    return null;
  }
  const before = positionsBefore({ rule, seriesStart, seriesZone, split });
  return before === null ? null : withRemainingCount(recurrence, before);
}

/** The COUNT a series' rule ends after, if it has one. */
export function countOf(recurrence: string[] | undefined): number | undefined {
  for (const line of recurrence ?? []) {
    const count = ruleCount(line);
    if (count !== null) {
      return count;
    }
  }
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
