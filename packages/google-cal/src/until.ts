/**
 * A series' UNTIL and its EXDATE/RDATE lines: an UNTIL written so the end
 * day's occurrence is included, read back as a day, and every value kept
 * in the form Google requires (dates for an all-day series, date-times for
 * a timed one). Shared by the server and both apps.
 */
import { Temporal } from "temporal-polyfill";
import { isRuleDay } from "./rule-days";

const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
const SEVERAL_A_DAY =
  /(?:[:;])(?:FREQ=(?:HOURLY|MINUTELY|SECONDLY)|BY(?:HOUR|MINUTE|SECOND)=[^;]*,)/;

const CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=([^;]*)/g;

/** A rule's own time of day, as it writes it ("BYHOUR=9;BYMINUTE=30"). */
function clockParts(line: string): string {
  return [...line.matchAll(CLOCK_PART)]
    .map((match) => `${match[1]}=${match[2]}`)
    .sort()
    .join(";");
}

/**
 * Whether a series meets more than once a day: a rule with several times
 * (BYHOUR=9,15) or a sub-daily frequency, or rules at different times
 * (one at 9:00, another at 15:00). Its times are then its own: they
 * aren't lined up with the start, and a skipped time stays that time.
 */
export function meetsSeveralTimesADay(recurrence: string[]): boolean {
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  return (
    rules.some((line) => SEVERAL_A_DAY.test(line)) ||
    new Set(rules.map(clockParts)).size > 1
  );
}

/**
 * UNTIL for a series that ends on `day` in `timeZone`, that day's
 * occurrence included: the date itself for an all-day series, otherwise
 * the day's last second, in UTC (midnight would drop a 10 AM meeting).
 */
export function untilRuleForDay(
  day: Temporal.PlainDate,
  allDay: boolean,
  timeZone: string
): string {
  if (allDay) {
    return compactDate(day);
  }
  const instant = day
    .toZonedDateTime({ plainTime: "23:59:59", timeZone })
    .toInstant();
  return `${instant.toString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** The day an UNTIL (or any date / date-time value) falls on in `timeZone`. */
export function untilRuleToDay(
  until: string,
  timeZone: string
): Temporal.PlainDate | null {
  const cleaned = until.replace(/[-:]/g, "");
  const dateOnly = UNTIL_DATE.exec(cleaned);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return Temporal.PlainDate.from(`${y}-${m}-${d}`);
  }
  const full = UNTIL_DATE_TIME.exec(cleaned);
  if (!full) {
    return null;
  }
  const [, y, m, d, hh, mm, ss, offset] = full;
  try {
    // No offset: a local time in `timeZone` (a TZID value).
    if (!offset) {
      return Temporal.PlainDate.from(`${y}-${m}-${d}`);
    }
    const zone =
      offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    return Temporal.Instant.from(`${y}-${m}-${d}T${hh}:${mm}:${ss}${zone}`)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

function compactDate(day: Temporal.PlainDate): string {
  return day.toString().replace(/-/g, "");
}

/** A start as Google writes it: a date (all day) or a date-time. */
interface StartTime {
  date?: string | null;
  dateTime?: string | null;
}

/** The start's wall-clock time in `timeZone` ("09:00"), for a timed one. */
function wallClock(start: StartTime, timeZone: string): Temporal.PlainTime {
  try {
    return start.dateTime
      ? Temporal.Instant.from(start.dateTime)
          .toZonedDateTimeISO(timeZone)
          .toPlainTime()
      : Temporal.PlainTime.from("00:00");
  } catch {
    return Temporal.PlainTime.from("00:00");
  }
}

/** A recurrence value read: its day in the series' zone, its moment if timed. */
export interface RecurrenceValue {
  day: Temporal.PlainDate;
  instant: Temporal.Instant | null;
}

/**
 * Reads "20261128", "20261128T140000Z", or "20261128T090000" (a local time
 * in `valueZone`, its line's TZID) as the day it falls on in `seriesZone`:
 * a Tokyo series' Monday skipped as "Sunday 19:00 New York" is Monday.
 */
export function readRecurrenceValue(
  value: string,
  valueZone: string,
  seriesZone: string
): RecurrenceValue | null {
  // A Google date-time ("2026-11-01T09:00:00-05:00"): read as is, since
  // stripping its dashes would strip an offset's minus sign too.
  if (ISO_DATE_TIME.test(value)) {
    try {
      const instant = Temporal.Instant.from(value);
      return {
        day: instant.toZonedDateTimeISO(seriesZone).toPlainDate(),
        instant,
      };
    } catch {
      return null;
    }
  }
  const cleaned = value.replace(/[-:]/g, "");
  const date = UNTIL_DATE.exec(cleaned);
  if (date) {
    const [, y, m, d] = date;
    return { day: Temporal.PlainDate.from(`${y}-${m}-${d}`), instant: null };
  }
  const full = UNTIL_DATE_TIME.exec(cleaned);
  if (!full) {
    return null;
  }
  const [, y, m, d, hh, mm, ss, offset] = full;
  const local = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  try {
    let instant: Temporal.Instant;
    if (!offset) {
      instant = Temporal.PlainDateTime.from(local)
        .toZonedDateTime(valueZone)
        .toInstant();
    } else {
      const zone =
        offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
      instant = Temporal.Instant.from(`${local}${zone}`);
    }
    return {
      day: instant.toZonedDateTimeISO(seriesZone).toPlainDate(),
      instant,
    };
  } catch {
    return null;
  }
}

/** An EXDATE/RDATE line: its name, the zone its values are in, and them. */
export function parseDateList(
  line: string,
  seriesZone: string
): { name: string; values: string[]; zone: string } | null {
  const match = DATE_LIST.exec(line);
  if (!match) {
    return null;
  }
  const [, name = "", params = "", list = ""] = match;
  return {
    name,
    values: list.split(","),
    zone: TZID_PARAM.exec(params)?.[1] ?? seriesZone,
  };
}

/**
 * An EXDATE/RDATE line in the start's form, counted on the series' days:
 * dates for an all-day series; for a timed one, a skipped occurrence at
 * the series' (possibly new) start time on its day, so it stays skipped
 * when the series' time moves. An RDATE's own times stay its own.
 */
function matchDateList(
  line: string,
  start: StartTime,
  seriesZone: string,
  /** The rule repeats more than once a day: a skipped time is its own. */
  severalADay: boolean
): string {
  const list = parseDateList(line, seriesZone);
  if (!list) {
    return line;
  }
  const read = list.values.map((value) =>
    readRecurrenceValue(value, list.zone, seriesZone)
  );
  if (read.some((value) => value === null)) {
    return line;
  }
  const values = read as RecurrenceValue[];
  if (start.date) {
    return values.every((value) => value.instant === null)
      ? line
      : `${list.name};VALUE=DATE:${values.map((v) => compactDate(v.day)).join(",")}`;
  }
  // Times of their own stay theirs: an RDATE's, or any in a rule with
  // several times a day (moving a skipped 15:00 to the start's 9:00 would
  // un-skip it).
  if (
    (list.name === "RDATE" || severalADay) &&
    values.every((value) => value.instant)
  ) {
    return line;
  }
  const time = wallClock(start, seriesZone);
  const moments = values.map((value) =>
    value.day.toZonedDateTime({ plainTime: time, timeZone: seriesZone })
  );
  const same = moments.every(
    (moment, index) =>
      values[index]?.instant &&
      Temporal.Instant.compare(
        moment.toInstant(),
        values[index].instant as Temporal.Instant
      ) === 0
  );
  if (same) {
    return line;
  }
  const clock = time.toString({ smallestUnit: "second" }).replace(/:/g, "");
  return `${list.name};TZID=${seriesZone}:${values
    .map((value) => `${compactDate(value.day)}T${clock}`)
    .join(",")}`;
}

/**
 * An RRULE whose single BYHOUR / BYMINUTE / BYSECOND fixes the time set to
 * the start's (moving a "BYHOUR=9" series to 10:00 moves the rule too, or
 * it keeps meeting at 9). A series that meets several times a day (several
 * values, or rules at different times) keeps its own times.
 */
function matchClock(
  line: string,
  start: StartTime,
  timeZone: string,
  severalADay: boolean
): string {
  if (!start.dateTime || severalADay) {
    return line;
  }
  const time = wallClock(start, timeZone);
  const parts = { BYHOUR: time.hour, BYMINUTE: time.minute, BYSECOND: time.second };
  return line.replace(
    /([:;])(BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g,
    (_, separator: string, part: keyof typeof parts) =>
      `${separator}${part}=${parts[part]}`
  );
}

/** An RRULE line with its UNTIL in the start's form. */
function matchUntil(line: string, allDay: boolean, timeZone: string): string {
  const match = UNTIL_PART.exec(line);
  const until = match?.[2];
  if (!(match && until) || until.includes("T") !== allDay) {
    return line;
  }
  const day = untilRuleToDay(until, timeZone);
  return day
    ? line.replace(
        UNTIL_PART,
        `${match[1]}UNTIL=${untilRuleForDay(day, allDay, timeZone)}`
      )
    : line;
}

/**
 * `recurrence` in the form `start` takes, as Google requires: UNTIL and
 * EXDATE/RDATE values are dates for an all-day series and date-times for a
 * timed one (that day's last second for UNTIL; a skipped occurrence at the
 * series' start time on its day in `timeZone`, the series' zone, so it
 * stays skipped). The same array when it already is.
 */
export function matchRecurrenceToStart(
  recurrence: string[],
  start: StartTime,
  timeZone: string
): string[] {
  const allDay = Boolean(start.date);
  const severalADay = meetsSeveralTimesADay(recurrence);
  let changed = false;
  const next = recurrence.map((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchClock(
          matchUntil(line, allDay, timeZone),
          start,
          timeZone,
          severalADay
        )
      : matchDateList(line, start, timeZone, severalADay);
    changed ||= matched !== line;
    return matched;
  });
  return changed ? next : recurrence;
}

/**
 * The move's shift within one repeat period (`period` days), in its
 * direction: Fri -> Mon is +3 days, Mon -> the next week's Wed +2, and
 * Mon -> the Sunday before -1. Every occurrence moves by it.
 */
function shiftWithinPeriod(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  period: number
): number {
  return withinPeriod(from.until(to).days, period);
}

/** `n` steps (days, months, years) within one period of `period`, signed. */
function withinPeriod(n: number, period: number): number {
  const forward = ((n % period) + period) % period;
  return n >= 0 || forward === 0 ? forward : forward - period;
}

/**
 * Where a monthly or yearly skip sits once the move is applied in calendar
 * terms: the move's months (years for a rule in one month a year) within
 * INTERVAL, then its leftover days, so "a month and a day" is that across
 * February too, and the 1st -> the 31st is 30 days.
 */
function calendarTarget(
  freq: string,
  rule: string,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): Temporal.PlainDate {
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1) || 1;
  const byYear = freq === "YEARLY" && periodDays(freq, rule) >= YEAR_DAYS;
  const move = from.until(to, { largestUnit: byYear ? "years" : "months" });
  // A yearly rule in several months meets about monthly: a month apart.
  const step = freq === "MONTHLY" ? interval : 1;
  return byYear
    ? day.add({
        days: move.days,
        months: move.months,
        years: withinPeriod(move.years, interval),
      })
    : day.add({ days: move.days, months: withinPeriod(move.months, step) });
}

/** Days in a month and a year, near enough to place a skip within one. */
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

/**
 * How far apart a rule's meetings fall, in days: INTERVAL days, weeks,
 * months or years (a yearly rule in several months meets about monthly).
 */
function periodDays(freq: string, rule: string): number {
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1) || 1;
  const months = /BYMONTH=([^;]*)/.exec(rule)?.[1]?.split(",") ?? [];
  switch (freq) {
    case "DAILY":
      return interval;
    case "WEEKLY":
      return 7 * interval;
    case "MONTHLY":
      return MONTH_DAYS * interval;
    default:
      return months.length === 1 ||
        (months.length === 0 && !/BYMONTHDAY=/.test(rule))
        ? YEAR_DAYS * interval
        : MONTH_DAYS;
  }
}

/**
 * The new rule's day nearest `target`, within half a period, the side
 * the move went first on a tie; null when none is that close.
 */
function nearestRuleDay(
  newRule: string,
  to: Temporal.PlainDate,
  target: Temporal.PlainDate,
  period: number,
  forward: boolean
): Temporal.PlainDate | null {
  for (let distance = 0; distance <= period / 2; distance += 1) {
    const sides = forward ? [distance, -distance] : [-distance, distance];
    for (const offset of sides) {
      const day = target.add({ days: offset });
      if (isRuleDay(newRule, to, day) === true) {
        return day;
      }
    }
  }
  return null;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** The first day of `day`'s week, by the rule's WKST (Monday by default). */
function weekStart(day: Temporal.PlainDate, rule: string): Temporal.PlainDate {
  const first = WEEKDAY_CODES.indexOf(/WKST=([A-Z]{2})/.exec(rule)?.[1] ?? "MO") + 1 || 1;
  return day.subtract({ days: (day.dayOfWeek - first + 7) % 7 });
}

/** Whether a weekly rule (starting `to`) still meets on `day`'s weekday. */
function keepsWeekday(
  rule: string,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  const days = /BYDAY=([^;]*)/.exec(rule)?.[1]?.split(",") ?? [];
  const code = WEEKDAY_CODES[day.dayOfWeek - 1] ?? "";
  return days.length > 0 ? days.includes(code) : to.dayOfWeek === day.dayOfWeek;
}

/**
 * Where a skipped occurrence of the old pattern sits in the new one: moved
 * as the pattern did, by the move's signed shift within one period (Fri
 * -> Mon is +3 days; a weekly rule that kept its days moves only by the
 * weeks; Jan 31 -> Feb 1 is a day, Feb 1 -> Mar 2 a day, a month's move
 * plus 5 days is 5 days), on the new rule's day nearest that. A skip marks when the person is
 * away, so it stays next to that time. Null when the new rule has no day
 * within half a period: the skip then stays.
 */
function placeInNewPattern(
  freq: string,
  newRule: string,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): Temporal.PlainDate | null {
  const period = periodDays(freq, newRule);
  if (freq === "DAILY" || freq === "WEEKLY") {
    const shift =
      freq === "WEEKLY" && keepsWeekday(newRule, to, day)
        ? // The days stayed (Mon/Tue kept when the start moved onto Tue):
          // only the weeks moved, so the skip keeps its weekday.
          shiftWithinPeriod(weekStart(from, newRule), weekStart(to, newRule), period)
        : shiftWithinPeriod(from, to, period);
    const target = day.add({ days: shift });
    return isRuleDay(newRule, to, target) === true ? target : null;
  }
  return nearestRuleDay(
    newRule,
    to,
    calendarTarget(freq, newRule, from, to, day),
    period,
    Temporal.PlainDate.compare(to, from) >= 0
  );
}

/**
 * EXDATE days moved with a series whose pattern followed its start from
 * `from` to `to` (Mondays became Tuesdays, the 2nd Tue the 3rd Wed): a
 * skipped occurrence of the old pattern on or after `from` that the new
 * rule no longer produces moves to its place in the new pattern (the same shift for a daily or
 * weekly rule; the new rule's day in that month for a monthly or yearly
 * one), at its own time, so it stays skipped. One the new rule still
 * produces is a skipped date, and stays. The same array when none moves.
 */
export function moveSkippedDays(params: {
  from: Temporal.PlainDate;
  newRule: string;
  /** The rule before the move: only its own days move. */
  oldRule: string;
  recurrence: string[];
  seriesZone: string;
  to: Temporal.PlainDate;
  /** The new start's time in the series' zone; null for an all-day one. */
  toTime?: Temporal.PlainTime | null;
}): string[] {
  const { from, newRule, oldRule, recurrence, seriesZone, to, toTime } =
    params;
  const freq = /FREQ=([A-Z]+)/.exec(newRule)?.[1] ?? "";
  const placeOf = (day: Temporal.PlainDate): Temporal.PlainDate | null => {
    if (Temporal.PlainDate.compare(day, from) < 0) {
      return null;
    }
    // Only a skipped occurrence of the old pattern that the new one no
    // longer has moves; any other skipped day is a date, and stays.
    if (
      isRuleDay(oldRule, from, day) !== true ||
      isRuleDay(newRule, to, day) !== false
    ) {
      return null;
    }
    const place = placeInNewPattern(freq, newRule, from, to, day);
    // A place before the new start matches nothing, the new start is the
    // meeting just moved there, and a day the old pattern met on was a
    // real meeting: the skip never lands on any of them.
    return place &&
      Temporal.PlainDate.compare(place, to) > 0 &&
      isRuleDay(oldRule, from, place) !== true
      ? place
      : null;
  };
  // The new start is the day the person picked: never left skipped (in a
  // rule with several times a day, only the start's own time is: a
  // skipped other time that day stays).
  const severalADay = meetsSeveralTimesADay(recurrence);
  const isNewStart = (value: RecurrenceValue | null) =>
    Boolean(
      value &&
        Temporal.PlainDate.compare(value.day, to) === 0 &&
        !(
          severalADay &&
          value.instant &&
          !(
            toTime &&
            Temporal.PlainTime.compare(
              value.instant.toZonedDateTimeISO(seriesZone).toPlainTime(),
              toTime
            ) === 0
          )
        )
    );
  let changed = false;
  const next = recurrence.flatMap((line) => {
    const list = line.startsWith("EXDATE") ? parseDateList(line, seriesZone) : null;
    if (!list) {
      return [line];
    }
    const read = list.values.map((value) =>
      readRecurrenceValue(value, list.zone, seriesZone)
    );
    const moved = read.map((value) => (value ? placeOf(value.day) : null));
    const dropped = read.map((value) => isNewStart(value));
    if (moved.every((day) => day === null) && !dropped.some(Boolean)) {
      return [line];
    }
    changed = true;
    const timed = read.some((value) => value?.instant);
    const values = read.flatMap((value, index) => {
      if (dropped[index]) {
        return [];
      }
      const day = moved[index] ?? value?.day;
      if (!(value && day)) {
        return [list.values[index] ?? ""];
      }
      if (!value.instant) {
        return [compactDate(day)];
      }
      const clock = value.instant
        .toZonedDateTimeISO(seriesZone)
        .toPlainTime()
        .toString({ smallestUnit: "second" })
        .replace(/:/g, "");
      return [`${compactDate(day)}T${clock}`];
    });
    if (values.length === 0) {
      return [];
    }
    return [
      timed
        ? `${list.name};TZID=${seriesZone}:${values.join(",")}`
        : `${list.name};VALUE=DATE:${values.join(",")}`,
    ];
  });
  return changed ? next : recurrence;
}
