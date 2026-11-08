import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";
import type { CreateEvent, Event } from "./schema";
import {
  countedRuleMeetings,
  DATE_ONLY,
  parseDateList,
  type RecurrenceValue,
  readRecurrenceValue,
  ruleClock,
  ruleTimeOf,
  untilMoment,
} from "./until";

const COUNT_REGEX = /;?COUNT=([^;]+)/;
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
const COUNT_PART = /([:;])COUNT=[^;]+/;

/**
 * The series' rule cut to end just before the occurrence that started at
 * `originalStart` (a "2026-11-10" date for an all-day series, a date-time
 * otherwise): the day before as a date for an all-day series (UNTIL takes
 * its start's form), the second before otherwise. COUNT goes; UNTIL
 * replaces it.
 */
export function truncateRecurrenceForFollowing(
  recurrence: string[],
  originalStart: string,
  /** The series' zone, for the days of its RDATE values. */
  seriesZone = "UTC",
  /** The series' first start, where a COUNT counts from. */
  seriesStart?: string
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
  const splitDay = DATE_ONLY.test(originalStart)
    ? Temporal.PlainDate.from(originalStart)
    : Temporal.Instant.from(originalStart)
        .toZonedDateTimeISO(seriesZone)
        .toPlainDate();
  // The split as a moment (a date: its day's start), to compare ends with.
  const splitMoment = DATE_ONLY.test(originalStart)
    ? splitDay.toZonedDateTime({ timeZone: seriesZone }).toInstant()
    : Temporal.Instant.from(originalStart);
  const firstValue = seriesStart ? asValue(seriesStart, seriesZone) : null;
  // A rule that ends before the split keeps its end; one that can't be
  // told is cut, so nothing after the split is left running.
  const endsBeforeSplit = (line: string) =>
    ruleEndsBefore(line, firstValue, splitMoment, seriesZone) === true;
  return splitAddedDays(recurrence, originalStart, seriesZone, "before").map(
    (line) => {
      if (!line.startsWith("RRULE:")) {
        return line;
      }
      // A rule that already ends before the split keeps its end: the cut
      // never lengthens it.
      if (endsBeforeSplit(line)) {
        return line;
      }
      // Part by part, so a rule written COUNT-first ("RRULE:COUNT=5;...")
      // leaves no empty part behind.
      const parts = line
        .slice("RRULE:".length)
        .split(";")
        .filter(
          (part) =>
            part && !part.startsWith("COUNT=") && !part.startsWith("UNTIL=")
        );
      return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
    }
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
      ? line.replace(COUNT_PART, `$1COUNT=${Math.max(1, count - used)}`)
      : line;
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
 * A split series' RDATE days (added occurrences, which UNTIL doesn't cut):
 * the ones before the split stay with the old part, the rest go with the
 * new one, so none is lost or doubled.
 */
export function splitAddedDays(
  recurrence: string[],
  originalStart: string,
  seriesZone: string,
  keep: "before" | "from"
): string[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith("RDATE")
      ? parseDateList(line, seriesZone)
      : null;
    if (!list) {
      return [line];
    }
    const kept = list.values.filter((value) => {
      const read = readRecurrenceValue(value, list.zone, seriesZone);
      return read
        ? beforeSplit(read, originalStart, seriesZone) === (keep === "before")
        : true;
    });
    if (kept.length === list.values.length) {
      return [line];
    }
    return kept.length > 0
      ? [`${line.slice(0, line.lastIndexOf(":") + 1)}${kept.join(",")}`]
      : [];
  });
}

/** Whether the series adds days of its own (RDATE). */
function hasAddedDays(recurrence: string[]): boolean {
  return recurrence.some((line) => line.startsWith("RDATE"));
}

/** A Google start ("2026-11-10" or a date-time) as a recurrence value. */
function asValue(start: string, seriesZone: string): RecurrenceValue | null {
  return readRecurrenceValue(start, seriesZone, seriesZone);
}

/** A value as a moment: its own, or its day's start in `seriesZone`. */
function momentOf(
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
    const key = value.instant
      ? `t${value.instant.epochMilliseconds}`
      : `d${value.day.toString()}`;
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
export type SplitBlock = "addedOccurrence" | "severalRules";

/**
 * Whether deleting from `originalStart` on could lengthen the series: the
 * split is an added (RDATE) meeting and a rule's end can't be told, so
 * cutting it there might reach past where it really ended. The delete is
 * then refused rather than guessed.
 */
export function followingCutUnsure(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): boolean {
  const recurrence = params.masterRecurrence ?? [];
  const split = asValue(params.originalStart, params.seriesZone);
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    params.seriesZone
  );
  if (
    !(split && addsSlot(recurrence, params.originalStart, params.seriesZone))
  ) {
    return false;
  }
  const at = momentOf(split, params.seriesZone);
  return recurrence
    .filter(isRule)
    .some(
      (rule) => ruleEndsBefore(rule, first, at, params.seriesZone) === null
    );
}

/**
 * Whether `slot` (an original start, as Google writes them) is one of the
 * series' added (RDATE) meetings, a rule's meeting at the same slot too
 * (whether it then counts as the rule's is the caller's to say).
 */
export function addsSlot(
  recurrence: string[],
  slot: string,
  seriesZone: string
): boolean {
  const value = asValue(slot, seriesZone);
  return Boolean(
    value &&
      addedValues(recurrence, seriesZone).some((added) =>
        sameValue(added, value)
      )
  );
}

/**
 * Whether a series starting at `start` has added (RDATE) meetings before
 * that start.
 */
export function addsBeforeStart(
  recurrence: string[],
  start: { date?: string | null; dateTime?: string | null },
  seriesZone: string
): boolean {
  const first = asValue(start.dateTime ?? start.date ?? "", seriesZone);
  if (!first) {
    return false;
  }
  const from = momentOf(first, seriesZone);
  return addedValues(recurrence, seriesZone).some(
    (added) => Temporal.Instant.compare(momentOf(added, seriesZone), from) < 0
  );
}

/** A series' added (RDATE) values. */
function addedValues(
  recurrence: string[],
  seriesZone: string
): RecurrenceValue[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith("RDATE")
      ? parseDateList(line, seriesZone)
      : null;
    return (list?.values ?? []).flatMap((value) => {
      const read = list && readRecurrenceValue(value, list.zone, seriesZone);
      return read ? [read] : [];
    });
  });
}

/**
 * Whether "This and following" can't start a new series at the
 * occurrence whose original start is `originalStart`: a new series repeats
 * from its start, so it must be one of the rule's own meetings. A series
 * with several rules (only imported calendars write them) can't keep each
 * rule's days and phase from one start, nor can an added (RDATE) meeting
 * that isn't a rule meeting too. Null when the split is fine.
 */
export function followingSplitBlocked(params: {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}): SplitBlock | null {
  const recurrence = params.masterRecurrence ?? [];
  const rules = recurrence.filter(isRule);
  if (rules.length > 1) {
    return "severalRules";
  }
  const split = asValue(params.originalStart, params.seriesZone);
  if (
    !(split && addsSlot(recurrence, params.originalStart, params.seriesZone))
  ) {
    return null;
  }
  // An added meeting that's also a rule meeting (its day, the series'
  // time) is the rule's: it can start a new series.
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
 * Whether `rule`, repeating from the series' `first` start, meets at
 * `slot`: on one of its days, before its end, at its time (Google meets a
 * rule once a day, at its one BYHOUR / BYMINUTE or the start's; a list
 * there it ignores). Null when that can't be told.
 */
function ruleHasSlot(
  rule: string,
  first: RecurrenceValue,
  slot: RecurrenceValue,
  seriesZone: string
): boolean | null {
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
    momentOf(slot, seriesZone),
    seriesZone
  );
  return ended === null ? null : !ended;
}

/**
 * Whether a series repeating with `recurrence` from `start` has a meeting
 * at `slot` (an original start, as Google writes them): its start, an
 * added (RDATE) meeting, or one of its rules' (skipped EXDATE ones
 * aside). Google keeps an occurrence's own changes only while its series
 * still has its original slot. Null when that can't be told.
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
  // Every meeting takes the start's form: a date-time slot isn't on an
  // all-day series, nor a date on a timed one.
  if (Boolean(first.instant) !== Boolean(slot.instant)) {
    return false;
  }
  // An exclusion rule isn't read here: whether it drops `slot` can't be
  // told.
  if (recurrence.some((line) => line.startsWith("EXRULE"))) {
    return null;
  }
  const at = (values: RecurrenceValue[]) =>
    values.some((value) => sameValue(value, slot));
  const skipped = recurrence.flatMap((line) => {
    const list = line.startsWith("EXDATE")
      ? parseDateList(line, seriesZone)
      : null;
    return (list?.values ?? []).flatMap((value) => {
      const read = list && readRecurrenceValue(value, list.zone, seriesZone);
      return read ? [read] : [];
    });
  });
  if (at(skipped)) {
    return false;
  }
  if (sameValue(first, slot) || at(addedValues(recurrence, seriesZone))) {
    return true;
  }
  if (
    Temporal.Instant.compare(
      momentOf(slot, seriesZone),
      momentOf(first, seriesZone)
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
 * Whether a plain hourly (minutely, secondly) rule ends before `split`:
 * its last meeting is INTERVAL x (COUNT - 1) steps on from the first. Null
 * with BY parts, or across a clock change (calendars step by wall time or
 * by elapsed time; it can't be told which).
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
  // Any clock change between the first and last meeting, even one undone
  // by the next, makes the wall-time and elapsed-time readings differ.
  const change = first.instant
    .toZonedDateTimeISO(seriesZone)
    .getTimeZoneTransition("next");
  if (change && Temporal.Instant.compare(change.toInstant(), last) <= 0) {
    return null;
  }
  return Temporal.Instant.compare(last, split) < 0;
}

/**
 * Whether `rule` ends before `split` (a moment): its UNTIL's moment is
 * earlier, or its last COUNT meeting is (counted from the series' `first`
 * start, one meeting a day at the rule's time). Null when that
 * can't be told: a rule it can't walk, or no first start.
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
  const count = Number(COUNT_REGEX.exec(rule)?.[1]);
  if (!Number.isFinite(count)) {
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
  // A timed rule is counted meeting by meeting, so a time the clocks
  // skip that day isn't one (RFC 5545; see until.ts `existsOn`).
  if (clock && time) {
    const meetings = countedRuleMeetings({
      base: clock,
      count,
      from: first.day,
      rule,
      time,
      timeZone: seriesZone,
    });
    return meetings && meetings.size === count
      ? Math.max(...meetings) < split.epochMilliseconds
      : null;
  }
  const last = countedRuleDays(rule, first.day, count)?.at(-1);
  if (!last) {
    return null;
  }
  // Its last day's meeting, at the rule's time (or that day's start).
  const lastAt = last
    .toZonedDateTime({
      plainTime: time ?? clock ?? undefined,
      timeZone: seriesZone,
    })
    .toInstant();
  return Temporal.Instant.compare(lastAt, split) < 0;
}

/**
 * The following part of a split series' rule, with the COUNT the user
 * kept carried on. COUNT counts rule positions, EXDATE-skipped ones
 * included, while Google lists rule occurrences (skipped ones aside) and
 * RDATE-added ones, an added day that's also a rule day only once. So,
 * when the rule can't be walked (`carryCountExactly`):
 * - with no added days, the positions used before the split are those
 *   listed before it plus the skipped days before it, and the new part
 *   runs what's left (a five-time series split at its third runs three);
 * - with added days, listed ones can't be told apart from rule ones, so
 *   what's left can't be known: null.
 */
export function carryCount(
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
  const exact = carryCountExactly(recurrence, params);
  if (exact) {
    return exact;
  }
  const { masterRecurrence, originalStart, seriesZone, starts } = params;
  if (hasAddedDays(masterRecurrence)) {
    return null;
  }
  const before = (value: RecurrenceValue) =>
    beforeSplit(value, originalStart, seriesZone);
  const skipped = masterRecurrence.flatMap((line) => {
    const list = parseDateList(line, seriesZone);
    return list?.name === "EXDATE"
      ? list.values
          .map((value) => readRecurrenceValue(value, list.zone, seriesZone))
          .filter((value): value is RecurrenceValue => value !== null)
      : [];
  });
  // Each position once: a skipped day Google also lists (as a cancelled
  // occurrence) isn't counted twice.
  const used = unique([
    ...starts
      .map((start) => asValue(start, seriesZone))
      .filter((value): value is RecurrenceValue => value !== null)
      .filter(before),
    ...skipped.filter(before),
  ]).length;
  return withRemainingCount(recurrence, used);
}

const isRule = (line: string) => line.startsWith("RRULE:");

/**
 * The new part's rules with each counted rule's meetings left: the
 * positions after the split, and its start counted first for a rule that
 * meets at its time (as the series' start counts only for a rule at its
 * time), one more when it isn't the rule's own. A rule with none of its
 * own left is done, unless no rule is left to carry the part: the first
 * such then ends at the part's start (`splitUntil`), so the part has its
 * start and nothing more, whatever the rule's time.
 */
function withCountsLeft(
  recurrence: string[],
  used: ({ before: number; own: boolean } | null)[],
  splitClock: Temporal.PlainTime | null,
  /** The new part's start as an UNTIL value. */
  splitUntil: string
): string[] {
  // null: not a counted rule, left as is.
  const left: (number | null)[] = [];
  let index = -1;
  for (const line of recurrence) {
    if (isRule(line)) {
      index += 1;
    }
    const rule = isRule(line) ? used[index] : null;
    const count = Number(COUNT_REGEX.exec(line)?.[1]);
    if (!(rule && Number.isFinite(count))) {
      left.push(null);
      continue;
    }
    const own = count - rule.before;
    const atSplitTime =
      !splitClock ||
      Temporal.PlainTime.compare(ruleClock(line, splitClock), splitClock) === 0;
    left.push(own > 0 && atSplitTime && !rule.own ? own + 1 : own);
  }
  const carried = recurrence.some(
    (line, i) => isRule(line) && (left[i] ?? 1) > 0
  );
  let keptSpent = false;
  return recurrence.flatMap((line, i) => {
    const n = left[i];
    if (n === null || n === undefined) {
      return [line];
    }
    if (n > 0) {
      return [line.replace(COUNT_PART, `$1COUNT=${n}`)];
    }
    if (carried || keptSpent) {
      return [];
    }
    keptSpent = true;
    return untilInstead([line], splitUntil);
  });
}

/**
 * How many of a COUNT `rule`'s positions come before the split, and
 * whether the split is one of them, walked from the series' start. Null
 * when they can't be told.
 */
function positionsUsed(params: {
  count: number;
  rule: string;
  seriesClock: Temporal.PlainTime | null;
  seriesStart: RecurrenceValue;
  seriesZone: string;
  split: RecurrenceValue;
}): { before: number; own: boolean } | null {
  const { count, rule, seriesClock, seriesStart, seriesZone, split } = params;
  const splitInstant = split.instant;
  if (seriesClock && seriesStart.instant && splitInstant) {
    // Timed: its meetings as moments at its own time (BYHOUR=15 at
    // 15:00), none before the series' start, which is its first only for
    // a rule at its time.
    const clock = ruleClock(rule, seriesClock);
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
        clock,
        from: seriesStart.instant,
        meetings,
        rule,
        seriesZone,
      })
    ) {
      return null;
    }
    const at = splitInstant.epochMilliseconds;
    return {
      before: [...meetings].filter((ms) => ms < at).length,
      own: meetings.has(at),
    };
  }
  // All day: positions are days.
  const positions = countedRuleDays(rule, seriesStart.day, count, true);
  if (!positions) {
    return null;
  }
  return {
    before: positions.filter(
      (day) => Temporal.PlainDate.compare(day, split.day) < 0
    ).length,
    own: positions.some(
      (day) => Temporal.PlainDate.compare(day, split.day) === 0
    ),
  };
}

/**
 * Whether a rule's counted `meetings` passed a rule day whose `clock`
 * time the clocks skip (a 2:30 AM meeting on the spring-forward night),
 * from the series' start to its last meeting. RFC 5545 drops that
 * meeting, but Google's own list says what it did, so the count is left
 * to that (see until.ts `existsOn`).
 */
function skipsAClockGap(params: {
  clock: Temporal.PlainTime;
  from: Temporal.Instant;
  meetings: Set<number>;
  rule: string;
  seriesZone: string;
}): boolean {
  const { clock, from, meetings, rule, seriesZone } = params;
  const start = from.toZonedDateTimeISO(seriesZone).toPlainDate();
  const last = Temporal.Instant.fromEpochMilliseconds(Math.max(...meetings))
    .toZonedDateTimeISO(seriesZone)
    .toPlainDate();
  for (
    let day = start;
    Temporal.PlainDate.compare(day, last) <= 0;
    day = day.add({ days: 1 })
  ) {
    const at = day
      .toZonedDateTime({ plainTime: clock, timeZone: seriesZone })
      .toInstant();
    if (
      !existsAt(day, clock, seriesZone) &&
      Temporal.Instant.compare(at, from) >= 0 &&
      isRuleDay(rule, start, day) === true
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The following part's rules with exactly the positions each has left:
 * every rule is walked from the series' start, its first COUNT days are
 * its positions (skipped ones included, added ones not), and the new part
 * runs the ones from the split on. Each rule counts its own, so a second
 * rule with all its positions before the split is dropped. Null when a
 * counted rule can't be read; `carryCount` then works from Google's list.
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
  const { masterRecurrence, originalStart, seriesStart, seriesZone } = params;
  const masterRules = masterRecurrence.filter(isRule);
  const seriesStartValue = asValue(seriesStart, seriesZone);
  const split = asValue(originalStart, seriesZone);
  if (
    !(seriesStartValue && split) ||
    masterRules.length !== recurrence.filter(isRule).length
  ) {
    return null;
  }
  const seriesClock = seriesStartValue.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  // Positions each rule used before the split, and whether the split is
  // one of its own meetings.
  const used: ({ before: number; own: boolean } | null)[] = [];
  const splitClock = split.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  for (const rule of masterRules) {
    const count = Number(COUNT_REGEX.exec(rule)?.[1]);
    if (!Number.isFinite(count)) {
      used.push(null);
      continue;
    }
    const positions = positionsUsed({
      count,
      rule,
      seriesClock: seriesClock ?? null,
      seriesStart: seriesStartValue,
      seriesZone,
      split,
    });
    if (!positions) {
      return null;
    }
    used.push(positions);
  }
  if (used.every((n) => n === null)) {
    return null;
  }
  return withCountsLeft(
    recurrence,
    used,
    splitClock ?? null,
    split.instant
      ? split.instant.toString({ smallestUnit: "second" }).replace(/[-:]/g, "")
      : split.day.toString().replace(/-/g, "")
  );
}

/**
 * Whether `time` exists on `day` in `zone`: not in a spring-forward gap,
 * where it would come out as a later time (a repeated fall-back hour
 * exists, once or twice, and is fine).
 */
function existsAt(
  day: Temporal.PlainDate,
  time: Temporal.PlainTime,
  zone: string
): boolean {
  const zoned = day.toZonedDateTime({ plainTime: time, timeZone: zone });
  return Temporal.PlainTime.compare(zoned.toPlainTime(), time) === 0;
}

/** The rule with its COUNT swapped for `until`. */
function untilInstead(recurrence: string[], until: string): string[] {
  return recurrence.map((line) =>
    line.startsWith("RRULE:")
      ? `RRULE:${[
          ...line
            .slice("RRULE:".length)
            .split(";")
            .filter((part) => part && !part.startsWith("COUNT=")),
          `UNTIL=${until}`,
        ].join(";")}`
      : line
  );
}

/** The COUNT a series' rule ends after, if it has one. */
export function countOf(recurrence: string[] | undefined): number | undefined {
  for (const line of recurrence ?? []) {
    const count = line.startsWith("RRULE:")
      ? Number(COUNT_REGEX.exec(line)?.[1])
      : Number.NaN;
    if (Number.isFinite(count)) {
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
