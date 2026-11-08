import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";
import type { CreateEvent, Event } from "./schema";
import {
  countedRuleMeetings,
  parseDateList,
  type RecurrenceValue,
  readRecurrenceValue,
  ruleTimesOf,
  untilMoment,
  untilRuleForDay,
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
const SEVERAL_TIMES = /[:;]BY(?:HOUR|MINUTE|SECOND)=[^;]*,/;
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

/** A value's place in time: its moment, or its day's start (UTC). */
function order(value: RecurrenceValue): number {
  return value.instant
    ? value.instant.epochMilliseconds
    : Date.UTC(value.day.year, value.day.month - 1, value.day.day);
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

/**
 * Whether an added (RDATE) value is also one of the rule's occurrences:
 * on one of its days, at the series' time (or both all day). Null when
 * the rule has parts `isRuleDay` doesn't read, or meets several times a
 * day (which of its times is the series' isn't read here).
 */
function isRuleOccurrence(
  rule: string,
  start: RecurrenceValue,
  value: RecurrenceValue,
  seriesZone: string
): boolean | null {
  if (SEVERAL_TIMES.test(rule)) {
    return null;
  }
  const onRuleDay = isRuleDay(rule, start.day, value.day);
  if (onRuleDay !== true) {
    return onRuleDay;
  }
  if (!(start.instant && value.instant)) {
    return !(start.instant || value.instant);
  }
  return (
    Temporal.PlainTime.compare(
      start.instant.toZonedDateTimeISO(seriesZone).toPlainTime(),
      value.instant.toZonedDateTimeISO(seriesZone).toPlainTime()
    ) === 0
  );
}

/**
 * The added days that aren't also rule occurrences. Each is checked
 * against the rule; for a rule with parts that can't be read, COUNT says
 * how many there are (distinct days beyond it) and the latest added days
 * are taken, since added days usually run past the rule.
 */
function extraAddedDays(params: {
  added: RecurrenceValue[];
  count: number | undefined;
  distinctDays: number;
  masterRecurrence: string[];
  seriesStart: string;
  seriesZone: string;
}): RecurrenceValue[] {
  const { added, masterRecurrence, seriesZone } = params;
  const rule = masterRecurrence.find((line) => line.startsWith("RRULE:"));
  const start = asValue(params.seriesStart, seriesZone);
  const verdicts = added.map((value) =>
    rule && start ? isRuleOccurrence(rule, start, value, seriesZone) : null
  );
  if (verdicts.every((verdict) => verdict !== null)) {
    return added.filter((_, index) => !verdicts[index]);
  }
  const extras = Math.max(
    0,
    params.distinctDays - (params.count ?? params.distinctDays)
  );
  return [...added].sort((a, b) => order(b) - order(a)).slice(0, extras);
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
    !(
      split &&
      addedValues(recurrence, params.seriesZone).some((v) =>
        sameValue(v, split)
      )
    )
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
  const added = addedValues(recurrence, params.seriesZone);
  if (!(split && added.some((value) => sameValue(value, split)))) {
    return null;
  }
  // An added meeting that's also a rule meeting (its day, the series'
  // time) is the rule's: it can start a new series.
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    params.seriesZone
  );
  const rule = rules[0];
  const clock = (value: RecurrenceValue | null) =>
    value?.instant?.toZonedDateTimeISO(params.seriesZone).toPlainTime();
  const firstClock = clock(first);
  const splitClock = clock(split);
  const ruleMeeting =
    rule &&
    first &&
    isRuleDay(rule, first.day, split.day) === true &&
    ruleEndsBefore(
      rule,
      first,
      momentOf(split, params.seriesZone),
      params.seriesZone
    ) === false &&
    (!(firstClock && splitClock) ||
      Temporal.PlainTime.compare(ruleClock(rule, firstClock), splitClock) ===
        0);
  return ruleMeeting ? null : "addedOccurrence";
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
  const offset = (at: Temporal.Instant) =>
    at.toZonedDateTimeISO(seriesZone).offsetNanoseconds;
  if (offset(first.instant) !== offset(last)) {
    return null;
  }
  return Temporal.Instant.compare(last, split) < 0;
}

/**
 * Whether `rule` ends before `split` (a moment): its UNTIL's moment is
 * earlier, or its last COUNT meeting is (counted from the series' `first`
 * start, each time of a rule meeting several times a day). Null when that
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
  const times = clock ? ruleTimesOf(rule, clock) : null;
  // A timed rule is counted meeting by meeting, so a time the clocks
  // skip that day isn't one (RFC 5545; see until.ts `existsOn`).
  if (clock && times && times.length > 0) {
    const meetings = countedRuleMeetings({
      base: clock,
      count,
      from: first.day,
      rule,
      times,
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
      plainTime: times?.[0] ?? clock ?? undefined,
      timeZone: seriesZone,
    })
    .toInstant();
  return Temporal.Instant.compare(lastAt, split) < 0;
}

/**
 * The following part of a split series' rule, with the COUNT the user
 * kept carried on. COUNT counts rule positions, EXDATE-skipped ones
 * included, while Google lists rule occurrences (skipped ones aside) and
 * RDATE-added ones, an added day that's also a rule day only once. So:
 * - with no added days, the positions used before the split are those
 *   listed before it plus the skipped days before it, and the new part
 *   runs what's left (a five-time series split at its third runs three);
 * - with added days, listed ones can't be told apart from rule ones, so
 *   the new part ends where the old series' rule did instead: UNTIL its
 *   last listed occurrence that isn't an added day.
 */
export function carryCount(
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesZone: string;
    /** Every occurrence's original start, as Google lists them. */
    starts: string[];
    /** The new part's start (it may move off the split's day or time). */
    newStart: string;
    /** The series' own first start, where its rule counts from. */
    seriesStart: string;
  }
): string[] {
  const {
    masterRecurrence,
    newStart,
    originalStart,
    seriesStart,
    seriesZone,
    starts,
  } = params;
  const listed = starts
    .map((start) => asValue(start, seriesZone))
    .filter((value): value is RecurrenceValue => value !== null);
  const listedValues = (name: "EXDATE" | "RDATE") =>
    masterRecurrence.flatMap((line) => {
      const list = parseDateList(line, seriesZone);
      return list?.name === name
        ? list.values
            .map((value) => readRecurrenceValue(value, list.zone, seriesZone))
            .filter((value): value is RecurrenceValue => value !== null)
        : [];
    });
  const exact = carryCountExactly(recurrence, params);
  if (exact) {
    return exact;
  }
  if (hasAddedDays(masterRecurrence)) {
    // The rule's last day is the latest listed one that isn't an extra
    // added day; an added day that's also a rule day stays one.
    const extraDays = extraAddedDays({
      added: unique(listedValues("RDATE")),
      count: countOf(masterRecurrence),
      distinctDays: unique([...listed, ...listedValues("EXDATE")]).length,
      masterRecurrence,
      seriesStart,
      seriesZone,
    });
    const ruleDays = listed.filter(
      (value) => !extraDays.some((day) => sameValue(day, value))
    );
    const last = ruleDays.reduce<RecurrenceValue | null>(
      (latest, value) =>
        !latest || order(value) > order(latest) ? value : latest,
      null
    );
    // The new part may start a day (or days) off the split; its last
    // occurrence is that far off the old rule's last one. UNTIL is that
    // day's end, so a later time that day still counts.
    const from = asValue(originalStart, seriesZone);
    const to = asValue(newStart, seriesZone);
    const shift = from && to ? from.day.until(to.day).days : 0;
    return last
      ? untilInstead(
          recurrence,
          untilRuleForDay(
            last.day.add({ days: shift }),
            DATE_ONLY.test(newStart),
            seriesZone
          )
        )
      : recurrence;
  }
  const before = (value: RecurrenceValue) =>
    beforeSplit(value, originalStart, seriesZone);
  // Each position once: a skipped day Google also lists (as a cancelled
  // occurrence) isn't counted twice.
  const used = unique([
    ...listed.filter(before),
    ...listedValues("EXDATE").filter(before),
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
    // Each rule meets at its own time (BYHOUR=15 at 15:00); the series'
    // first start is the first position only of a rule at its time.
    const clock = seriesClock && ruleClock(rule, seriesClock);
    const atSeriesTime =
      !(clock && seriesClock) ||
      Temporal.PlainTime.compare(clock, seriesClock) === 0;
    const positions = countedRuleDays(
      rule,
      seriesStartValue.day,
      count,
      atSeriesTime
    );
    // A position whose time doesn't exist that day (a 2:30 AM meeting on
    // the spring-forward night): RFC 5545 drops it, but Google's own list
    // says what it did, so count from that (see until.ts `existsOn`).
    if (
      !positions ||
      (clock && positions.some((day) => !existsAt(day, clock, seriesZone)))
    ) {
      return null;
    }
    const splitInstant = split.instant;
    // How a position compares with the split: by moment, or by day.
    const vsSplit = (day: Temporal.PlainDate, position: number) =>
      clock && splitInstant
        ? Temporal.Instant.compare(
            position === 0 && atSeriesTime && seriesStartValue.instant
              ? seriesStartValue.instant
              : day
                  .toZonedDateTime({ plainTime: clock, timeZone: seriesZone })
                  .toInstant(),
            splitInstant
          )
        : Temporal.PlainDate.compare(day, split.day);
    used.push({
      before: positions.filter((day, i) => vsSplit(day, i) < 0).length,
      own: positions.some((day, i) => vsSplit(day, i) === 0),
    });
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

const SINGLE_CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g;

/** The time of day a rule meets: its single BYHOUR / BYMINUTE / BYSECOND over `base`. */
function ruleClock(rule: string, base: Temporal.PlainTime): Temporal.PlainTime {
  const parts = new Map(
    [...rule.matchAll(SINGLE_CLOCK_PART)].map((match) => [
      match[1],
      Number(match[2]),
    ])
  );
  return base.with({
    hour: parts.get("BYHOUR") ?? base.hour,
    minute: parts.get("BYMINUTE") ?? base.minute,
    second: parts.get("BYSECOND") ?? base.second,
  });
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
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}
