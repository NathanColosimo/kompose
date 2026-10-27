/**
 * A parsed phrase + "now" → dates. Conventions (training/SPEC.md): a bare
 * weekday is the next one on or after today; "next <weekday>" the coming
 * one; bare hours 1-7 are pm; day parts start at 9/13/18/20h; a time
 * already past today with no day named is tomorrow.
 */
import { Temporal } from "temporal-polyfill";
import { holidayDate } from "../holidays";
import type { TaskRecurrence } from "../recurrence";
import type {
  DaySpec,
  MonthRef,
  Part,
  Phrase,
  RepeatSpec,
  TimeSpec,
  Unit,
} from "./grammar";
import { DAY_PARTS } from "./lexicon";

export interface When {
  date: Temporal.PlainDate;
  /** End of an explicit time range ("2-2:30pm"). */
  end: Temporal.PlainDateTime | null;
  recurrence: TaskRecurrence | null;
  /** The phrase repeats, even if the schema can't hold how. */
  repeats: boolean;
  /** Null when the phrase named a day but no time. */
  time: Temporal.PlainTime | null;
}

type Weekday = Extract<TaskRecurrence, { freq: "WEEKLY" }>["byDay"][number];
type SpecOf<T extends DaySpec["type"]> = Extract<DaySpec, { type: T }>;
type MonthRule = SpecOf<"nthWeekday" | "nthDay">;
const CODES: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function lastDay(year: number, month: number) {
  return Temporal.PlainDate.from({ day: 1, month, year }).daysInMonth;
}

function dateIn(year: number, month: number, day: number) {
  return Temporal.PlainDate.from({
    day: Math.min(day, lastDay(year, month)),
    month,
    year,
  });
}

const before = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) < 0;

function nthWeekdayOf(
  year: number,
  month: number,
  weekday: number,
  nth: number
) {
  if (nth > 0) {
    const first = dateIn(year, month, 1);
    return first.add({
      days: ((weekday - first.dayOfWeek + 7) % 7) + (nth - 1) * 7,
    });
  }
  const last = dateIn(year, month, 31);
  return last.subtract({ days: (last.dayOfWeek - weekday + 7) % 7 });
}

function nthDayOf(year: number, month: number, nth: number, business: boolean) {
  if (!business) {
    return nth > 0 ? dateIn(year, month, nth) : dateIn(year, month, 31);
  }
  let day = nth > 0 ? dateIn(year, month, 1) : dateIn(year, month, 31);
  let found = 0;
  const step = nth > 0 ? 1 : -1;
  for (;;) {
    if (day.dayOfWeek <= 5) {
      found += 1;
      if (found === Math.abs(nth)) {
        return day;
      }
    }
    day = day.add({ days: step });
  }
}

/** The month a MonthRef means: [year, month], and whether it's fixed. */
function monthOf(
  ref: MonthRef,
  today: Temporal.PlainDate
): [number, number, boolean] {
  if ("months" in ref) {
    const first = today.with({ day: 1 }).add({ months: ref.months });
    return [first.year, first.month, ref.months > 0];
  }
  const year = ref.month < today.month ? today.year + 1 : today.year;
  return [year, ref.month, false];
}

/** The earliest of the rule's days in that month that isn't past `from`. */
function ruleDayIn(
  spec: MonthRule,
  year: number,
  month: number,
  from: Temporal.PlainDate
) {
  const dates = spec.nths.map((nth) =>
    spec.type === "nthWeekday"
      ? nthWeekdayOf(year, month, spec.weekday, nth)
      : nthDayOf(year, month, nth, spec.business)
  );
  const upcoming = dates
    .filter((candidate) => !before(candidate, from))
    .sort(Temporal.PlainDate.compare);
  return (
    upcoming[0] ??
    (dates.sort(Temporal.PlainDate.compare)[0] as Temporal.PlainDate)
  );
}

/** A rule over months (nth weekday/day) on or after `from`. */
function monthRuleDate(
  spec: DaySpec,
  from: Temporal.PlainDate
): Temporal.PlainDate | null {
  if (spec.type !== "nthWeekday" && spec.type !== "nthDay") {
    return null;
  }
  let [year, month, fixed] = monthOf(spec.month, from);
  let date = ruleDayIn(spec, year, month, from);
  for (let tries = 0; before(date, from) && tries < 24; tries += 1) {
    if (fixed) {
      break;
    }
    // A named month rolls a year; "the month" rolls a month.
    const next =
      "month" in spec.month
        ? Temporal.PlainDate.from({ day: 1, month, year: year + 1 })
        : Temporal.PlainDate.from({ day: 1, month, year }).add({ months: 1 });
    [year, month] = [next.year, next.month];
    date = ruleDayIn(spec, year, month, from);
  }
  return date;
}

function weekStart(today: Temporal.PlainDate, weeks: number) {
  return today.subtract({ days: today.dayOfWeek - 1 }).add({ weeks });
}

const PART_DAYS: Record<string, number> = {
  early: 0,
  end: 6,
  late: 4,
  mid: 2,
  start: 0,
};

/** The day of the month a part of it starts on ("mid" is the 15th). */
function partDayOfMonth(part: Part) {
  if (part === "mid") {
    return 15;
  }
  return part === "late" || part === "end" ? 31 : 1;
}

/** The day a part of a year starts on ("mid" is July 1st). */
function partDateOfYear(year: number, part: Part) {
  if (part === "mid") {
    return dateIn(year, 7, 1);
  }
  return part === "late" || part === "end"
    ? dateIn(year, 12, 31)
    : dateIn(year, 1, 1);
}

/** "nov 3": this year's, or next year's once it's past. */
function resolveDate(spec: SpecOf<"date">, today: Temporal.PlainDate) {
  if (spec.day > lastDay(spec.year ?? today.year, spec.month)) {
    return null;
  }
  if (spec.year !== null) {
    return Temporal.PlainDate.from({
      day: spec.day,
      month: spec.month,
      year: spec.year,
    });
  }
  const date = dateIn(today.year, spec.month, spec.day);
  return before(date, today)
    ? dateIn(today.year + 1, spec.month, spec.day)
    : date;
}

function resolveWeekday(spec: SpecOf<"weekday">, today: Temporal.PlainDate) {
  if (spec.weeks !== undefined) {
    const date = weekStart(today, spec.weeks).add({
      days: spec.weekday - 1,
    });
    return before(date, today) ? date.add({ weeks: 1 }) : date;
  }
  let days = (spec.weekday - today.dayOfWeek + 7) % 7;
  if (spec.next && days === 0) {
    days = 7;
  }
  if (spec.after) {
    days += days === 0 ? 14 : 7;
  }
  return today.add({ days });
}

function resolveMonthDay(spec: SpecOf<"monthDay">, today: Temporal.PlainDate) {
  const base = today.with({ day: 1 }).add({ months: spec.months });
  const date = dateIn(base.year, base.month, spec.day);
  if (before(date, today)) {
    const next = base.add({ months: 1 });
    return dateIn(next.year, next.month, spec.day);
  }
  return date;
}

function resolveMonth(spec: SpecOf<"month">, today: Temporal.PlainDate) {
  const year =
    spec.year ?? (spec.month < today.month ? today.year + 1 : today.year);
  const day = partDayOfMonth(spec.part);
  const date = dateIn(year, spec.month, day);
  if (!before(date, today) || spec.year !== null) {
    return date;
  }
  // "in november" during November is now.
  const thisMonth =
    spec.month === today.month &&
    (spec.part === "whole" || spec.part === "start" || spec.part === "early");
  return thisMonth ? today : dateIn(year + 1, spec.month, day);
}

function resolveWeek(spec: SpecOf<"week">, today: Temporal.PlainDate) {
  if (spec.part === "weekend") {
    const saturday = today.add({ days: (6 - today.dayOfWeek + 7) % 7 });
    if (spec.weeks === 0) {
      return saturday;
    }
    return today.dayOfWeek === 6 ? saturday.add({ weeks: 1 }) : saturday;
  }
  if (spec.part === "whole") {
    return spec.weeks === 0 ? today : weekStart(today, spec.weeks);
  }
  const date = weekStart(today, spec.weeks).add({
    days: PART_DAYS[spec.part] ?? 0,
  });
  return before(date, today) ? today : date;
}

function resolveMonthOf(spec: SpecOf<"monthOf">, today: Temporal.PlainDate) {
  const first = today.with({ day: 1 }).add({ months: spec.months });
  if (spec.part === "whole") {
    return spec.months === 0 ? today : first;
  }
  const date = dateIn(first.year, first.month, partDayOfMonth(spec.part));
  return before(date, today) ? today : date;
}

function resolveYearOf(spec: SpecOf<"yearOf">, today: Temporal.PlainDate) {
  const year = today.year + spec.years;
  if (spec.part === "whole") {
    return spec.years === 0 ? today : dateIn(year, 1, 1);
  }
  const date = partDateOfYear(year, spec.part);
  return before(date, today) ? today : date;
}

export function resolveDay(
  spec: DaySpec,
  today: Temporal.PlainDate
): Temporal.PlainDate | null {
  switch (spec.type) {
    case "date":
      return resolveDate(spec, today);
    case "relative":
      return today.add({ days: spec.days });
    case "weekday":
      return resolveWeekday(spec, today);
    case "monthDay":
      return resolveMonthDay(spec, today);
    case "month":
      return resolveMonth(spec, today);
    case "offset":
      return spec.unit === "hour" || spec.unit === "minute"
        ? null
        : today.add({ [`${spec.unit}s`]: spec.amount });
    case "week":
      return resolveWeek(spec, today);
    case "monthOf":
      return resolveMonthOf(spec, today);
    case "yearOf":
      return resolveYearOf(spec, today);
    case "quarterEnd": {
      const quarter = spec.quarter ?? Math.ceil(today.month / 3);
      const end = dateIn(today.year, quarter * 3, 31);
      return before(end, today) ? end.add({ years: 1 }) : end;
    }
    case "holiday":
      return holidayDate(spec.name, today);
    case "nthWeekday":
    case "nthDay":
      return monthRuleDate(spec, today);
    default:
      return null;
  }
}

/** A clock time, with am/pm inferred from the day part or the 1-7 pm rule. */
function clockOf(time: TimeSpec, part: Phrase["part"]): Temporal.PlainTime {
  let hour = time.hour % 24;
  if (time.meridiem === "am") {
    hour = time.hour % 12;
  } else if (time.meridiem === "pm") {
    hour = (time.hour % 12) + 12;
  } else if (time.meridiem === null) {
    if (part === "morning") {
      hour = time.hour % 12;
    } else if (part === "night" && time.hour <= 4) {
      hour = time.hour % 12;
    } else if (part) {
      hour = (time.hour % 12) + 12;
    } else if (time.hour >= 1 && time.hour <= 7) {
      hour = time.hour + 12;
    }
  }
  return Temporal.PlainTime.from({ hour, minute: time.minute });
}

/** The range end: shares the start's am/pm when it has none. */
function endOf(start: TimeSpec, end: TimeSpec, part: Phrase["part"]) {
  let startTime = clockOf(start, part);
  let endTime = clockOf(end, part);
  if (
    start.meridiem === null &&
    (end.meridiem === "am" || end.meridiem === "pm")
  ) {
    // "11-1pm" starts at 11am; "2-3:30pm" at 2pm.
    const shared = clockOf({ ...start, meridiem: end.meridiem }, part);
    startTime =
      Temporal.PlainTime.compare(shared, endTime) <= 0
        ? shared
        : clockOf(
            { ...start, meridiem: end.meridiem === "pm" ? "am" : "pm" },
            part
          );
  } else if (
    end.meridiem === null &&
    Temporal.PlainTime.compare(endTime, startTime) <= 0 &&
    end.hour < 12
  ) {
    endTime = endTime.add({ hours: 12 });
  }
  return { endTime, startTime };
}

/** How a recurrence ends: after a count, on a date, or never. */
function recurrenceEnd(until: Temporal.PlainDate | null, count: number | null) {
  if (count !== null) {
    return { count };
  }
  return until ? { until: until.toString() } : {};
}

function toRecurrence(
  repeat: RepeatSpec,
  first: Temporal.PlainDate,
  until: Temporal.PlainDate | null,
  count: number | null
): TaskRecurrence | null {
  if (repeat.unsupported || repeat.monthRule) {
    return null;
  }
  const end = recurrenceEnd(until, count);
  switch (repeat.freq) {
    case "DAILY":
      return { ...end, freq: "DAILY", interval: repeat.interval };
    case "WEEKLY": {
      const days = repeat.byDay.length > 0 ? repeat.byDay : [first.dayOfWeek];
      return {
        ...end,
        byDay: [...days]
          .sort((a, b) => a - b)
          .map((day) => CODES[day - 1] as Weekday),
        freq: "WEEKLY",
        interval: repeat.interval,
      };
    }
    case "MONTHLY":
      return {
        ...end,
        byMonthDay: repeat.byMonthDay ?? first.day,
        freq: "MONTHLY",
        interval: repeat.interval,
      };
    case "YEARLY":
      return { ...end, freq: "YEARLY", interval: repeat.interval };
    default:
      return null;
  }
}

/** Whether `date` is an occurrence of the rule (ignoring the interval). */
function matches(
  repeat: RepeatSpec,
  date: Temporal.PlainDate,
  yearly: Temporal.PlainDate | null
) {
  switch (repeat.freq) {
    case "WEEKLY":
      return repeat.byDay.length === 0 || repeat.byDay.includes(date.dayOfWeek);
    case "MONTHLY":
      return (
        repeat.byMonthDay === null ||
        date.day === Math.min(repeat.byMonthDay, date.daysInMonth)
      );
    case "YEARLY":
      return (
        !yearly || (date.month === yearly.month && date.day === yearly.day)
      );
    default:
      return true;
  }
}

/** Occurrences in [first, first + span). */
function countIn(
  repeat: RepeatSpec,
  first: Temporal.PlainDate,
  span: { amount: number; unit: Unit },
  yearly: Temporal.PlainDate | null
) {
  const end = first.add({ [`${span.unit}s`]: Math.round(span.amount) });
  let count = 0;
  let date = first;
  let guard = 0;
  while (before(date, end) && guard < 800) {
    if (matches(repeat, date, yearly) && onInterval(repeat, first, date)) {
      count += 1;
    }
    date = date.add({ days: 1 });
    guard += 1;
  }
  return count;
}

function onInterval(
  repeat: RepeatSpec,
  first: Temporal.PlainDate,
  date: Temporal.PlainDate
) {
  if (repeat.interval === 1) {
    return true;
  }
  const days = first.until(date, { largestUnit: "days" }).days;
  switch (repeat.freq) {
    case "DAILY":
      return days % repeat.interval === 0;
    case "WEEKLY": {
      const weeks = Math.floor((days + first.dayOfWeek - 1) / 7);
      return weeks % repeat.interval === 0;
    }
    case "MONTHLY":
      return (
        ((date.year - first.year) * 12 + date.month - first.month) %
          repeat.interval ===
        0
      );
    default:
      return true;
  }
}

/** The start and end times a phrase names, or its day part's hour. */
function timesOf(phrase: Phrase) {
  const part = phrase.part;
  let time: Temporal.PlainTime | null = null;
  if (phrase.time) {
    time = clockOf(phrase.time, part);
  } else if (part) {
    time = Temporal.PlainTime.from({
      hour: DAY_PARTS[part]?.[0] ?? 9,
      minute: DAY_PARTS[part]?.[1] ?? 0,
    });
  }
  let end: Temporal.PlainTime | null = null;
  if (phrase.time && phrase.end) {
    const range = endOf(phrase.time, phrase.end, part);
    time = range.startTime;
    end = range.endTime;
  }
  if (phrase.noTime && !phrase.time) {
    time = null;
  }
  return { end, time };
}

/** "in 2 hours": now plus the offset, to the minute. */
function clockOffset(phrase: Phrase, now: Temporal.ZonedDateTime): When | null {
  const day = phrase.day;
  if (
    day?.type !== "offset" ||
    (day.unit !== "hour" && day.unit !== "minute")
  ) {
    return null;
  }
  const at = now
    .toPlainDateTime()
    .add({ [`${day.unit}s`]: day.amount })
    .with({ microsecond: 0, millisecond: 0, nanosecond: 0, second: 0 });
  return {
    date: at.toPlainDate(),
    end: null,
    recurrence: null,
    repeats: false,
    time: at.toPlainTime(),
  };
}

/** The named day, moved to its weekend or shifted ("a week from friday"). */
function shiftedDay(phrase: Phrase, today: Temporal.PlainDate) {
  let date = phrase.day ? resolveDay(phrase.day, today) : null;
  if (date && phrase.weekendOf) {
    // The Saturday of that day's weekend (Monday holidays: the one before).
    const shift =
      { 1: -2, 2: -3, 3: -4, 4: -5, 5: 1, 6: 0, 7: -1 }[date.dayOfWeek] ?? 0;
    date = date.add({ days: shift });
  }
  if (date && phrase.shift) {
    date = date.add({ days: phrase.shift });
  }
  return date;
}

/** "midnight" alone or tonight is the one at the end of today. */
function isMidnightAhead(phrase: Phrase) {
  return (
    !(phrase.day && phrase.day.type !== "relative") &&
    phrase.time?.hour === 0 &&
    phrase.time.minute === 0 &&
    phrase.time.meridiem === "24"
  );
}

/** The end of a time range; past midnight when it's not after the start. */
function rangeEndAt(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime | null,
  end: Temporal.PlainTime | null
) {
  if (!(end && time)) {
    return null;
  }
  const startAt = date.toPlainDateTime(time);
  const endAt = date.toPlainDateTime(end);
  return Temporal.PlainDateTime.compare(endAt, startAt) <= 0
    ? endAt.add({ days: 1 })
    : endAt;
}

/** Reads a phrase against `now` (in the user's zone). */
export function resolvePhrase(
  phrase: Phrase,
  now: Temporal.ZonedDateTime
): When | null {
  // A named day is the user's ("noon ET tomorrow"); a bare zoned time
  // ("3pm ET") is the next one there.
  const local =
    phrase.zone && !phrase.day ? now.withTimeZone(phrase.zone) : now;
  const today = local.toPlainDate();
  const repeat = phrase.repeat;
  if (
    (phrase.vague || phrase.relative) &&
    !phrase.day &&
    !phrase.start &&
    !repeat
  ) {
    return null;
  }

  const { end, time } = timesOf(phrase);
  const offset = clockOffset(phrase, now);
  if (offset) {
    return offset;
  }

  const date = shiftedDay(phrase, today);
  if (phrase.day && !date) {
    return null;
  }
  const start = phrase.start ? resolveDay(phrase.start, today) : null;

  if (repeat) {
    return resolveRepeat(phrase, repeat, {
      date,
      end,
      now,
      nowTime: local.toPlainTime(),
      start,
      time,
      today,
    });
  }
  return resolveOnce(phrase, { date: date ?? start, end, local, now, time });
}

/** A one-off phrase: its day (today when only a time is named) and time. */
function resolveOnce(
  phrase: Phrase,
  context: {
    date: Temporal.PlainDate | null;
    end: Temporal.PlainTime | null;
    local: Temporal.ZonedDateTime;
    now: Temporal.ZonedDateTime;
    time: Temporal.PlainTime | null;
  }
): When | null {
  const { end, local, now, time } = context;
  const named = context.date !== null;
  if (!(context.date || time)) {
    return null;
  }
  let date = context.date ?? local.toPlainDate();
  if (isMidnightAhead(phrase)) {
    date = date.add({ days: 1 });
  }
  const endDateTime = rangeEndAt(date, time, end);
  const when = finish(
    { date, end: endDateTime, recurrence: null, repeats: false, time },
    phrase,
    now
  );
  // A time already past today, with no day named, is tomorrow's ("at 3"
  // at 5pm). "This afternoon" and "tonight" stay today.
  if (!named && time && !phrase.today && when.time) {
    const at = date.toPlainDateTime(time);
    if (
      Temporal.PlainDateTime.compare(at, local.toPlainDateTime()) < 0 &&
      !(phrase.part === "night" && !phrase.time)
    ) {
      return finish(
        {
          date: date.add({ days: 1 }),
          end: endDateTime?.add({ days: 1 }) ?? null,
          recurrence: null,
          repeats: false,
          time,
        },
        phrase,
        now
      );
    }
  }
  return when;
}

/**
 * What the day piece says about the rule: "monthly on the 15th", "every
 * year on mar 3", "every week starting monday". Fills in `rule` and
 * returns the yearly anchor and where to start looking.
 */
function applyDayToRule(
  day: DaySpec | null,
  rule: RepeatSpec,
  context: {
    date: Temporal.PlainDate | null;
    start: Temporal.PlainDate | null;
    today: Temporal.PlainDate;
  }
): { from: Temporal.PlainDate; yearly: Temporal.PlainDate | null } {
  const { date, start, today } = context;
  let yearly: Temporal.PlainDate | null = null;
  let from = start ?? today;
  if (!day) {
    return { from, yearly };
  }
  if (
    rule.freq === "MONTHLY" &&
    day.type === "monthDay" &&
    rule.byMonthDay === null
  ) {
    rule.byMonthDay = day.day;
  } else if (
    rule.freq === "MONTHLY" &&
    (day.type === "nthWeekday" || day.type === "nthDay")
  ) {
    rule.monthRule = day;
  } else if (rule.freq === "YEARLY" && date) {
    yearly = date;
  } else if (
    rule.freq === "WEEKLY" &&
    day.type === "weekday" &&
    rule.byDay.length === 0
  ) {
    rule.byDay = [day.weekday];
  } else if (date && !start) {
    from = date;
  }
  return { from, yearly };
}

/** The rule's first date on or after `from` that isn't `past`. */
function firstOccurrence(
  rule: RepeatSpec,
  from: Temporal.PlainDate,
  yearly: Temporal.PlainDate | null,
  past: (candidate: Temporal.PlainDate) => boolean
): Temporal.PlainDate | null {
  if (rule.monthRule) {
    const first = monthRuleDate(rule.monthRule, from);
    return first && past(first)
      ? monthRuleDate(rule.monthRule, first.add({ days: 1 }))
      : first;
  }
  let candidate = from;
  for (let guard = 0; guard < 800; guard += 1) {
    if (matches(rule, candidate, yearly) && !past(candidate)) {
      return candidate;
    }
    candidate = candidate.add({ days: 1 });
  }
  return null;
}

function resolveRepeat(
  phrase: Phrase,
  repeat: RepeatSpec,
  context: {
    date: Temporal.PlainDate | null;
    end: Temporal.PlainTime | null;
    now: Temporal.ZonedDateTime;
    nowTime: Temporal.PlainTime;
    start: Temporal.PlainDate | null;
    time: Temporal.PlainTime | null;
    today: Temporal.PlainDate;
  }
): When | null {
  const { now, nowTime, start, time, today } = context;
  const rule: RepeatSpec = { ...repeat, byDay: [...repeat.byDay] };
  const anchor = applyDayToRule(phrase.day, rule, context);
  let yearly = anchor.yearly;
  if (
    rule.freq === "MONTHLY" &&
    rule.byMonthDay === null &&
    phrase.start?.type === "monthDay"
  ) {
    rule.byMonthDay = phrase.start.day;
  }
  if (rule.freq === "YEARLY" && !yearly && start) {
    yearly = start;
  }
  // The first occurrence on or after `from` (and after now when it's today).
  const past = (candidate: Temporal.PlainDate) =>
    candidate.equals(today) &&
    time !== null &&
    Temporal.PlainTime.compare(time, nowTime) < 0;
  const first = firstOccurrence(rule, anchor.from, yearly, past);
  if (!first) {
    return null;
  }
  const until = rule.until ? resolveDay(rule.until, today) : null;
  const count =
    rule.count ?? (rule.span ? countIn(rule, first, rule.span, yearly) : null);
  return finish(
    {
      date: first,
      end: null,
      recurrence: toRecurrence(rule, first, until, count),
      repeats: true,
      time,
    },
    phrase,
    now
  );
}

/** Converts a time given in another zone back to the user's. */
function finish(when: When, phrase: Phrase, now: Temporal.ZonedDateTime): When {
  if (!(phrase.zone && when.time)) {
    return when;
  }
  const move = (dateTime: Temporal.PlainDateTime) =>
    dateTime
      .toZonedDateTime(phrase.zone as string)
      .withTimeZone(now.timeZoneId)
      .toPlainDateTime();
  const start = move(when.date.toPlainDateTime(when.time));
  const days = when.date.until(start.toPlainDate(), {
    largestUnit: "days",
  }).days;
  let recurrence = when.recurrence;
  // "weekdays at 6:30pm ET" from Sydney is Tuesday to Saturday there.
  if (days !== 0 && recurrence?.freq === "WEEKLY") {
    const shifted = recurrence.byDay.map(
      (code) => CODES[(CODES.indexOf(code) + days + 7) % 7] as Weekday
    );
    recurrence = {
      ...recurrence,
      byDay: shifted.sort((a, b) => CODES.indexOf(a) - CODES.indexOf(b)),
    };
  }
  if (days !== 0 && recurrence?.freq === "MONTHLY") {
    recurrence = { ...recurrence, byMonthDay: start.day };
  }
  return {
    ...when,
    date: start.toPlainDate(),
    end: when.end && move(when.end),
    recurrence,
    time: start.toPlainTime(),
  };
}
