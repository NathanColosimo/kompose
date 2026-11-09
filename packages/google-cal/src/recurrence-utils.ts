import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";
import type { CreateEvent, Event } from "./schema";
import type { SeriesRefusal } from "./series-edits";
import {
  atOwnWallTime,
  countedRuleMeetings,
  DATE_ONLY,
  dateValues,
  existsOn,
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
  // Cut as one, then each unsure rule put back as it was: the cut keeps
  // the rules in their own order.
  const cut = truncateRecurrenceForFollowing(
    recurrence,
    originalStart,
    seriesZone,
    seriesStart
  );
  const cutRules = cut.filter(isRule);
  const lines = [
    ...rules.map((rule, index) =>
      unsure.includes(rule) ? rule : (cutRules[index] ?? rule)
    ),
    ...cut.filter((line) => !isRule(line)),
  ];
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
  return skipping(lines, theirs, seriesZone);
}

/** A This and following split of a series, as the helpers below read it. */
interface FollowingSplit {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}

/** A split's series rules, its first start and the split, read once. */
function readSplit(params: FollowingSplit) {
  const recurrence = params.masterRecurrence ?? [];
  return {
    first: asValue(
      params.masterStart.dateTime ?? params.masterStart.date ?? "",
      params.seriesZone
    ),
    recurrence,
    rules: recurrence.filter(isRule),
    split: asValue(params.originalStart, params.seriesZone),
  };
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
export function followingDelete(
  params: FollowingSplit
): "cut" | "list" | "refuse" {
  const { recurrence, rules } = readSplit(params);
  if (!followingCutUnsure(params)) {
    return "cut";
  }
  if (
    rules.every((rule) => ruleCount(rule) !== null || UNTIL_VALUE.test(rule))
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

/**
 * `recurrence` with its rule's COUNT changed `by` that many: raised for a
 * moved meeting's skip, or lowered for places a split's skips lose. A
 * split's carried COUNT is set from the series' own (`withCount`).
 */
export function changeCount(recurrence: string[], by: number): string[] {
  return recurrence.map((line) => {
    const count = ruleCount(line);
    return count === null ? line : setCount(line, count + by);
  });
}

/** A rule line ending after `count` meetings. */
function setCount(line: string, count: number): string {
  return line.replace(COUNT_PART, `$1COUNT=${count}`);
}

/**
 * `recurrence` with its rule ending after `count` meetings: the positions
 * a split's new part has left, worked out from the series' own COUNT.
 */
function withCount(recurrence: string[], count: number): string[] {
  return recurrence.map((line) =>
    ruleCount(line) === null ? line : setCount(line, count)
  );
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
type SplitBlock = Extract<
  SeriesRefusal["reason"],
  "addedOccurrence" | "severalRules"
>;

/**
 * Whether deleting from `originalStart` on could lengthen a rule: one whose
 * end can't be told would be cut there, which could run it past where it
 * really ended. That can happen at an added (RDATE) meeting, or, with
 * several rules, at another rule's meeting.
 */
function followingCutUnsure(params: FollowingSplit): boolean {
  const { first, recurrence, rules, split } = readSplit(params);
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
export function followingIsWhole(params: FollowingSplit): boolean {
  const { seriesZone } = params;
  const { first, recurrence, split } = readSplit(params);
  if (!(split && first)) {
    return false;
  }
  const moment = valueMoment(split, seriesZone);
  return (
    Temporal.Instant.compare(moment, valueMoment(first, seriesZone)) <= 0 &&
    !dateValues(recurrence, "RDATE", seriesZone).some(
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
export function followingSplitBlocked(
  params: FollowingSplit
): SplitBlock | null {
  const { first, recurrence, rules, split } = readSplit(params);
  const exclusions = recurrence.filter((line) => line.startsWith("EXRULE"));
  if (rules.length + exclusions.length > 1) {
    return "severalRules";
  }
  // The series' own start is its rule's anchor, added there too or not: a
  // new series from it repeats just as the old one did.
  if (
    !(split && addsSlot(recurrence, params.originalStart, params.seriesZone)) ||
    (first && sameValue(first, split))
  ) {
    return null;
  }
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
    (Temporal.PlainTime.compare(ruleClock(rule, firstClock), slotClock) !== 0 ||
      !(slot.instant && atOwnWallTime(slot.instant, seriesZone)))
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
 * can't be told, as for a COUNT when `first` isn't known (null): an UNTIL,
 * or no end, is told without it.
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
  const last = countedRuleDays({ count, rule, start: first.day })?.at(-1);
  if (!last) {
    return null;
  }
  // Timed rules were counted meeting by meeting above: this one is all day.
  const lastAt = last.toZonedDateTime({ timeZone: seriesZone }).toInstant();
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
 * split are the meetings listed there and the rule's skips it doesn't
 * list. When those can't be told (an added day there can't be told from
 * a rule day, a skip there Google doesn't list where the rule may meet may
 * or may not be a position, or a start at a time its rule doesn't meet may
 * or may not count), the positions left are counted from the split on
 * instead, the same way; null when neither side can be told. A skip after
 * Google's last listed meeting changes no meeting, so it's left out of the
 * count (`leftOut`, from the split on, when that side counts).
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
): {
  /** Skips from the split on it knows hold a place, by moment. */
  heldPlaces: number[];
  /** Skips from the split on it left out of the count, by moment. */
  leftOut: number[];
  recurrence: string[];
} | null {
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
  const skipped = unique(dateValues(masterRecurrence, "EXDATE", seriesZone));
  const startClock = start.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  // The time a once-a-day rule meets at; null for a rule that steps within
  // a day, or an all-day series.
  const ruleAt =
    startClock && !SUB_DAILY_UNIT[FREQ_VALUE.exec(rule)?.[1] ?? ""]
      ? ruleClock(rule, startClock)
      : null;
  // A skip on a day the rule doesn't meet, or at another time than the
  // rule's on a day that has it, is no position (the series' first start
  // counts whatever the rule says).
  const offRule = (skip: RecurrenceValue) => {
    if (sameValue(skip, start)) {
      return false;
    }
    const clock = skip.instant?.toZonedDateTimeISO(seriesZone).toPlainTime();
    const offTime = Boolean(
      clock &&
        ruleAt &&
        !clock.equals(ruleAt) &&
        existsOn(skip.day, ruleAt, seriesZone)
    );
    return (
      offTime ||
      (!skip.day.equals(start.day) &&
        isRuleDay(rule, start.day, skip.day) === false)
    );
  };
  // The last meeting Google lists that isn't an added day: the rule's
  // positions run on at least to it.
  const ruleMeetings = listed.filter(
    (value) => !added.some((day) => sameValue(day, value))
  );
  const lastMeeting = ruleMeetings.reduce<Temporal.Instant | null>(
    (last, value) => {
      const at = valueMoment(value, seriesZone);
      return last && Temporal.Instant.compare(last, at) >= 0 ? last : at;
    },
    null
  );
  // A skip after it changes no meeting, counted or not: it's left out.
  const afterLast = (skip: RecurrenceValue) =>
    lastMeeting === null ||
    Temporal.Instant.compare(valueMoment(skip, seriesZone), lastMeeting) > 0;
  // A skip at one of the rule's meetings, as it reads here (on its day, at
  // its time, the first pass of a repeated hour), is a position.
  const onRule = (skip: RecurrenceValue) => {
    const at = skip.instant;
    const clock = at?.toZonedDateTimeISO(seriesZone).toPlainTime();
    return (
      isRuleDay(rule, start.day, skip.day) === true &&
      (!(at && clock && startClock) ||
        (ruleClock(rule, startClock).equals(clock) &&
          atOwnWallTime(at, seriesZone)))
    );
  };
  // The positions in a stretch of the series: what Google lists there and
  // the rule's skips it doesn't, or null when an added day or an unlisted
  // skip that may be a position falls in it. An added day off the rule's
  // days or time is no position: Google lists it, but it isn't counted.
  const positionsIn = (inStretch: (value: RecurrenceValue) => boolean) => {
    const addedThere = added.filter(inStretch);
    const there = listed
      .filter(inStretch)
      .filter((value) => !addedThere.some((day) => sameValue(day, value)));
    const unlisted = skipped
      .filter(inStretch)
      .filter(
        (skip) =>
          !(
            offRule(skip) ||
            afterLast(skip) ||
            there.some((value) => sameValue(value, skip))
          )
      );
    const unclear =
      addedThere.some((day) => !offRule(day)) ||
      unlisted.some((skip) => !onRule(skip));
    return unclear ? null : there.length + unlisted.length;
  };
  // With `places` positions from the split on, the skips there Google
  // doesn't list that must hold one, by moment: all of them, when they and
  // its meetings there make up exactly that many.
  const countedAfter = (places: number) => {
    const fromSplit = (value: RecurrenceValue) =>
      !beforeSplit(value, originalStart, seriesZone);
    const meetings = ruleMeetings.filter(fromSplit);
    const unlisted = skipped.filter(
      (skip) =>
        fromSplit(skip) &&
        !offRule(skip) &&
        !listed.some((value) => sameValue(value, skip))
    );
    return meetings.length + unlisted.length === places
      ? unlisted.map((skip) => valueMoment(skip, seriesZone).epochMilliseconds)
      : [];
  };
  // The skips from the split on left out of the count, by moment.
  const leftOut = skipped
    .filter(
      (skip) =>
        !(beforeSplit(skip, originalStart, seriesZone) || offRule(skip)) &&
        afterLast(skip)
    )
    .map((skip) => valueMoment(skip, seriesZone).epochMilliseconds);
  const startAtRuleTime =
    !startClock || ruleClock(rule, startClock).equals(startClock);
  const before = startAtRuleTime
    ? positionsIn((value) => fromStartToSplit(value, params))
    : null;
  // Not used up before the split: the positions left are the rest.
  if (before !== null && before < count) {
    return {
      heldPlaces: countedAfter(count - before),
      leftOut: [],
      recurrence: withCount(recurrence, count - before),
    };
  }
  // Otherwise (used up before the split, it disagrees with Google's own
  // count of the start, or the start can't be told) the side from the
  // split on decides.
  const left = positionsIn(
    (value) => !beforeSplit(value, originalStart, seriesZone)
  );
  return left === null || left === 0
    ? null
    : {
        heldPlaces: [],
        leftOut,
        recurrence: withCount(recurrence, left),
      };
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
  count: number;
  rule: string;
  seriesStart: RecurrenceValue;
  seriesZone: string;
  split: RecurrenceValue;
}): number | null {
  const { count, rule, seriesStart, seriesZone, split } = params;
  if (seriesStart.instant && split.instant) {
    const seriesClock = seriesStart.instant
      .toZonedDateTimeISO(seriesZone)
      .toPlainTime();
    const clock = ruleClock(rule, seriesClock);
    if (!clock.equals(seriesClock)) {
      return null;
    }
    // Only the positions before the split are needed.
    const meetings = countedRuleMeetings({
      base: seriesClock,
      count,
      from: seriesStart.day,
      rule,
      through: split.day,
      time: clock,
      timeZone: seriesZone,
    });
    if (
      !meetings ||
      skipsAClockGap({
        before: split.instant,
        clock,
        from: seriesStart.instant,
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
    countedRuleDays({
      count,
      rule,
      start: seriesStart.day,
      through: split.day,
    })?.filter((day) => Temporal.PlainDate.compare(day, split.day) < 0)
      .length ?? null
  );
}

/**
 * Whether a rule passes a day before the split whose `clock` time
 * the clocks skip (2:30 AM on the spring-forward night). RFC 5545 drops
 * that meeting; Google's list shows what Google did, so the count is left
 * to it (see until.ts `existsOn`).
 */
function skipsAClockGap(params: {
  /** Only days before this count: a gap after it changes no position before. */
  before: Temporal.Instant;
  clock: Temporal.PlainTime;
  from: Temporal.Instant;
  rule: string;
  seriesZone: string;
}): boolean {
  const { before, clock, from, rule, seriesZone } = params;
  const start = from.toZonedDateTimeISO(seriesZone).toPlainDate();
  const last = before.toZonedDateTimeISO(seriesZone).toPlainDate();
  for (
    let day = start;
    Temporal.PlainDate.compare(day, last) <= 0;
    day = day.add({ days: 1 })
  ) {
    // Most days have the time: only a gap day is read further.
    if (existsOn(day, clock, seriesZone)) {
      continue;
    }
    const at = day
      .toZonedDateTime({ plainTime: clock, timeZone: seriesZone })
      .toInstant();
    if (
      Temporal.Instant.compare(at, from) >= 0 &&
      Temporal.Instant.compare(at, before) < 0 &&
      isRuleDay(rule, start, day) === true
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The following part's rule with exactly the positions it has left: the
 * series' COUNT less the positions before the split (skips included, added days
 * not). Null when the walk can't tell, or finds the COUNT used up before
 * the split (it disagrees with Google, whose list then decides).
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
  const rule = masterRecurrence.find(isRule);
  const seriesStart = asValue(params.seriesStart, seriesZone);
  const split = asValue(originalStart, seriesZone);
  const count = rule ? ruleCount(rule) : null;
  if (!(rule && count !== null && seriesStart && split)) {
    return null;
  }
  const before = positionsBefore({
    count,
    rule,
    seriesStart,
    seriesZone,
    split,
  });
  return before === null || before >= count
    ? null
    : withCount(recurrence, count - before);
}

/** The COUNT a series' rule ends after; null if it has none. */
export function countOf(recurrence: string[] | undefined): number | null {
  return ruleCount(recurrence?.find(isRule) ?? "");
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
