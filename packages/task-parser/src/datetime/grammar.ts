/**
 * Tokens → what a date phrase says: a day, a time of day, a range end, a
 * time zone and a repeat rule, each still relative to "now" (resolve.ts
 * turns them into dates).
 */
import { HOLIDAYS } from "./holidays";
import {
  CITY_ZONES,
  type DayPart,
  MONTHS,
  NUMBER_WORDS,
  ORDINAL_WORDS,
  WEEKDAYS,
  ZONES,
} from "./lexicon";
import type { Token } from "./tokens";

export type Unit = "minute" | "hour" | "day" | "week" | "month" | "year";

export type DaySpec =
  | { type: "date"; day: number; month: number; year: number | null }
  | { type: "relative"; days: number }
  /** "next" skips today; "after" adds a week ("friday after next"). */
  | {
      type: "weekday";
      weekday: number;
      next: boolean;
      after: boolean;
      /** That weekday in the calendar week this many weeks ahead ("tuesday next week"). */
      weeks?: number;
    }
  /** "the 15th" (of this or a later month); `months` > 0 for "of next month". */
  | { type: "monthDay"; day: number; months: number }
  | { type: "month"; month: number; year: number | null; part: Part }
  | { type: "offset"; amount: number; unit: Unit }
  | { type: "week"; weeks: number; part: Part | "weekend" }
  | { type: "monthOf"; months: number; part: Part }
  | { type: "yearOf"; years: number; part: Part }
  | { type: "quarterEnd"; quarter: number | null }
  | { type: "holiday"; name: string }
  /** nth weekdays of a month ("first monday of next month"); -1 = last. */
  | {
      type: "nthWeekday";
      nths: number[];
      weekday: number;
      month: MonthRef;
      repeats?: boolean;
    }
  /** nth business or calendar days of a month (-1 = last). `repeats`: "of each month". */
  | {
      type: "nthDay";
      nths: number[];
      business: boolean;
      month: MonthRef;
      repeats?: boolean;
    };

export type MonthRule = Extract<DaySpec, { type: "nthWeekday" | "nthDay" }>;
export type Part = "start" | "early" | "mid" | "late" | "end" | "whole";
/** A month relative to now ("months" from this one) or by name. */
export type MonthRef = { months: number } | { month: number };

export interface TimeSpec {
  hour: number;
  meridiem: "am" | "pm" | "24" | null;
  minute: number;
}

export interface RepeatSpec {
  byDay: number[];
  byMonthDay: number | null;
  count: number | null;
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  /** A month rule the task schema can't hold: only its first date is kept. */
  monthRule: MonthRule | null;
  /** "for 2 weeks": turned into a count once the rule is known. */
  span: { amount: number; unit: Unit } | null;
  /** Repeats more often than daily ("every 2 hours"): first date only. */
  unsupported: boolean;
  until: DaySpec | null;
}

export interface Phrase {
  day: DaySpec | null;
  end: TimeSpec | null;
  /** "eod": the day, explicitly with no time. */
  noTime: boolean;
  part: DayPart | null;
  /** Repeats counted from completion ("2 weeks after I finish"). */
  relative: boolean;
  repeat: RepeatSpec | null;
  /** Days added to `day` ("a week from friday", "the day before"). */
  shift: number;
  /** "starting next week": where a repeat (or the task) begins. */
  start: DaySpec | null;
  time: TimeSpec | null;
  /** "this afternoon": today even once it's over. */
  today: boolean;
  /** "later this week", "after lunch" alone: no concrete date. */
  vague: boolean;
  /** "labor day weekend": the Saturday of that day's weekend. */
  weekendOf: boolean;
  zone: string | null;
}

const WEEKDAY_INDEX = new Map<string, number>(
  WEEKDAYS.map((name, index) => [name, index + 1])
);
const PLURAL_WEEKDAYS = new Map<string, number>(
  WEEKDAYS.map((name, index) => [`${name}s`, index + 1])
);
const MONTH_INDEX = new Map<string, number>(
  MONTHS.map((name, index) => [name, index + 1])
);
const UNITS: Record<string, Unit> = {
  day: "day",
  days: "day",
  hour: "hour",
  hours: "hour",
  minute: "minute",
  minutes: "minute",
  month: "month",
  months: "month",
  week: "week",
  weeks: "week",
  year: "year",
  years: "year",
};
const MINUTE_WORDS: Record<string, number> = {
  fifteen: 15,
  five: 5,
  "forty five": 45,
  forty: 40,
  fifty: 50,
  "fifty five": 55,
  ten: 10,
  thirty: 30,
  "twenty five": 25,
  twenty: 20,
  oclock: 0,
};
const DAY_PART_ALIASES: Record<string, DayPart> = {
  afternoon: "afternoon",
  afternoons: "afternoon",
  eve: "evening",
  evening: "evening",
  evenings: "evening",
  morning: "morning",
  mornings: "morning",
  night: "night",
  nights: "night",
  tonight: "night",
};
const FREQUENCY_WORDS: Record<string, [RepeatSpec["freq"], number]> = {
  annual: ["YEARLY", 1],
  annually: ["YEARLY", 1],
  bimonthly: ["MONTHLY", 2],
  biweekly: ["WEEKLY", 2],
  daily: ["DAILY", 1],
  fortnightly: ["WEEKLY", 2],
  monthly: ["MONTHLY", 1],
  nightly: ["DAILY", 1],
  quarterly: ["MONTHLY", 3],
  semiannually: ["MONTHLY", 6],
  weekly: ["WEEKLY", 1],
  yearly: ["YEARLY", 1],
};
const WORKDAYS = [1, 2, 3, 4, 5];
const QUARTER = /^q([1-4])$/;
/** "q2", "q3d", "q14d": a clinical-style repeat interval. */
const CLINICAL_REPEAT = /^q(\d+)(d|w|wk|m)?$/;
/** "x10": a repeat count. */
const TIMES_SHORTHAND = /^x(\d+)$/;
const RANGE_WORDS = new Set(["to", "until", "through", "-", "–", "and"]);
const START_WORDS = new Set([
  "starting",
  "start",
  "beginning",
  "begin",
  "begins",
  "from",
  "effective",
  "commencing",
]);
const UNTIL_WORDS = new Set(["until", "through", "ending", "ends", "thru"]);
const TIME_LEADS = new Set([
  "at",
  "@",
  "around",
  "about",
  "by",
  "before",
  "after",
  "from",
  "until",
  "to",
  "between",
  "and",
  "~",
  "approx",
  "approximately",
]);

/** Words after a bare hour that make it a clock time ("4 pm", "4ish"). */
const CLOCK_MARKS = new Set(["am", "pm", "oclock", "ish", "sharp", "hrs", "h"]);

interface Reader {
  /** The phrase is a repeat span: bare weekdays mean "every". */
  repeating: boolean;
  tokens: Token[];
}

type Read<T> = { value: T; length: number } | null;

/** An ordinal: "3rd" or "third" (and "last" as -1 when allowed). */
function ordinalAt(token: Token | undefined, last = false): number | null {
  if (token?.kind === "number") {
    return token.ordinal ? token.value : null;
  }
  const text = word(token);
  if (text === null || (text === "last" && !last)) {
    return null;
  }
  return ORDINAL_WORDS[text] ?? null;
}

const word = (token: Token | undefined) =>
  token?.kind === "word" || token?.kind === "symbol" ? token.text : null;

const is = (token: Token | undefined, ...words: string[]) => {
  const text = word(token);
  return text !== null && words.includes(text);
};

/** A number written as digits or words ("twenty one", "forty-five"). */
function numberAt(tokens: Token[], i: number): Read<number> {
  const token = tokens[i];
  if (token?.kind === "number" && !token.ordinal) {
    return { length: 1, value: token.value };
  }
  const text = word(token);
  if (text === null || text === "a" || text === "an") {
    return null;
  }
  const value = NUMBER_WORDS[text];
  if (value === undefined || text === "couple" || text === "few") {
    return null;
  }
  // "twenty one", "forty-five"
  if (value >= 20 && value % 10 === 0) {
    const hyphen = is(tokens[i + 1], "-") ? 1 : 0;
    const unit = NUMBER_WORDS[word(tokens[i + 1 + hyphen]) ?? ""];
    if (unit !== undefined && unit >= 1 && unit <= 9) {
      return { length: 2 + hyphen, value: value + unit };
    }
  }
  return { length: 1, value };
}

/** An amount for an offset: a number, "a", "an", "a couple (of)", "a few", "half an". */
function amountAt(tokens: Token[], i: number): Read<number> {
  let at = i;
  if (is(tokens[at], "a", "an") && is(tokens[at + 1], "couple", "few")) {
    at += 1;
  }
  if (is(tokens[at], "couple", "few")) {
    const of = is(tokens[at + 1], "of") ? 1 : 0;
    return { length: at - i + 1 + of, value: is(tokens[at], "couple") ? 2 : 3 };
  }
  if (is(tokens[at], "half") && is(tokens[at + 1], "a", "an")) {
    return { length: 2, value: 0.5 };
  }
  if (is(tokens[at], "a", "an", "one")) {
    return { length: 1, value: 1 };
  }
  const number = numberAt(tokens, at);
  if (!number) {
    return null;
  }
  // "1.5 hours"
  const fraction = tokens[at + number.length + 1];
  if (
    is(tokens[at + number.length], ".") &&
    fraction?.kind === "number" &&
    !fraction.ordinal
  ) {
    return {
      length: number.length + 2,
      value: Number(`${number.value}.${fraction.digits}`),
    };
  }
  return number;
}

function unitAt(tokens: Token[], i: number): Read<Unit | "fortnight"> {
  const text = word(tokens[i]);
  if (text === "fortnight" || text === "fortnights") {
    return { length: 1, value: "fortnight" };
  }
  const unit = text === null ? undefined : UNITS[text];
  return unit ? { length: 1, value: unit } : null;
}

/** "in 2 weeks", "3 days from now", "in an hour and a half", "a fortnight". */
function readOffset(tokens: Token[], i: number): Read<DaySpec> {
  const lead = is(tokens[i], "in", "within") ? 1 : 0;
  if (lead && is(tokens[i + 1], "the") && is(tokens[i + 2], "next")) {
    const inner = readOffset(tokens, i + 2);
    return inner && { length: inner.length + 2, value: inner.value };
  }
  const start = i + lead;
  const amount = amountAt(tokens, start);
  let at = start + (amount?.length ?? 0);
  const unit = unitAt(tokens, at);
  if (!unit) {
    return null;
  }
  at += 1;
  let value = amount?.value ?? 1;
  if (!(amount || lead)) {
    return null;
  }
  // "an hour and a half"
  if (
    is(tokens[at], "and") &&
    is(tokens[at + 1], "a") &&
    is(tokens[at + 2], "half")
  ) {
    value += 0.5;
    at += 3;
  }
  const after =
    is(tokens[at], "from", "after") && is(tokens[at + 1], "now", "today");
  const later = is(tokens[at], "later");
  if (!(lead || after || later)) {
    return null;
  }
  if (after) {
    at += 2;
  } else if (later) {
    at += 1;
  }
  const spec = toOffset(value, unit.value);
  return spec && { length: at - i, value: spec };
}

function toOffset(amount: number, unit: Unit | "fortnight"): DaySpec | null {
  if (unit === "fortnight") {
    return { amount: amount * 14, type: "offset", unit: "day" };
  }
  if (Number.isInteger(amount)) {
    return { amount, type: "offset", unit };
  }
  // Fractions move down a unit: "1.5 hours" is 90 minutes.
  const smaller: Partial<Record<Unit, [Unit, number]>> = {
    day: ["hour", 24],
    hour: ["minute", 60],
    week: ["day", 7],
  };
  const down = smaller[unit];
  return down
    ? { amount: Math.round(amount * down[1]), type: "offset", unit: down[0] }
    : null;
}

/** A month name, with "of" before it allowed. */
function monthAt(tokens: Token[], i: number): Read<number> {
  const of = is(tokens[i], "of") ? 1 : 0;
  const month = MONTH_INDEX.get(word(tokens[i + of]) ?? "");
  // "may" is a month only next to a day number.
  return month ? { length: of + 1, value: month } : null;
}

function yearAt(tokens: Token[], i: number): Read<number> {
  const comma = is(tokens[i], ",", "-") ? 1 : 0;
  const token = tokens[i + comma];
  if (
    token?.kind === "number" &&
    !token.ordinal &&
    token.digits.length === 4 &&
    token.value >= 2000 &&
    token.value < 2100
  ) {
    return { length: comma + 1, value: token.value };
  }
  return null;
}

function dayNumberAt(tokens: Token[], i: number): Read<number> {
  const the = is(tokens[i], "the") ? 1 : 0;
  const token = tokens[i + the];
  if (token?.kind === "number" && token.value >= 1 && token.value <= 31) {
    // A bare number is a day only if it's short ("3", "03"), not "930".
    return token.digits.length <= 2
      ? { length: the + 1, value: token.value }
      : null;
  }
  // "november third"
  const ordinal = token?.kind === "word" ? ordinalAt(token) : null;
  return ordinal !== null && ordinal >= 1
    ? { length: the + 1, value: ordinal }
    : null;
}

/** "nov 3", "november 3rd, 2026", "3 nov", "the 3rd of november". */
function readCalendarDate(tokens: Token[], i: number): Read<DaySpec> {
  const token = tokens[i];
  if (token?.kind === "date") {
    return {
      length: 1,
      value: {
        day: token.day,
        month: token.month,
        type: "date",
        year: token.year,
      },
    };
  }
  const month = MONTH_INDEX.get(word(token) ?? "");
  if (month) {
    const dot = is(tokens[i + 1], ".") ? 1 : 0;
    const day = dayNumberAt(tokens, i + 1 + dot);
    if (day && !isClockAfter(tokens, i + 1 + dot + day.length)) {
      const year = yearAt(tokens, i + 1 + dot + day.length);
      return {
        length: 1 + dot + day.length + (year?.length ?? 0),
        value: {
          day: day.value,
          month,
          type: "date",
          year: year?.value ?? null,
        },
      };
    }
    return null;
  }
  const day = dayNumberAt(tokens, i);
  if (day) {
    // German "28. Oktober", "26-Oct-2026"
    const dot =
      is(tokens[i + day.length], ".", "-") &&
      monthAt(tokens, i + day.length + 1)
        ? 1
        : 0;
    const named = monthAt(tokens, i + day.length + dot);
    if (named) {
      const year = yearAt(tokens, i + day.length + dot + named.length);
      return {
        length: day.length + dot + named.length + (year?.length ?? 0),
        value: {
          day: day.value,
          month: named.value,
          type: "date",
          year: year?.value ?? null,
        },
      };
    }
  }
  return null;
}

/** Whether a clock word follows ("may 5pm" is not May 5). */
function isClockAfter(tokens: Token[], i: number) {
  return is(tokens[i], "am", "pm", "oclock", ":");
}

/** "the 15th", "on the 3rd", "the 5th of next month", "15th". */
function readMonthDay(tokens: Token[], i: number): Read<DaySpec> {
  const the = is(tokens[i], "the") ? 1 : 0;
  const value = ordinalAt(tokens[i + the]);
  if (value === null || value < 1 || value > 31) {
    return null;
  }
  // "the first frost", "first thing": an ordinal word is a day only at the
  // end or before a date word.
  const follower = tokens[i + the + 1];
  if (
    tokens[i + the]?.kind === "word" &&
    follower?.kind === "word" &&
    !is(
      follower,
      "of",
      "next",
      "at",
      "by",
      "on",
      "and",
      "am",
      "pm",
      "in",
      "this",
      "every",
      "each"
    ) &&
    !WEEKDAY_INDEX.has(word(follower) ?? "") &&
    !MONTH_INDEX.has(word(follower) ?? "") &&
    !DAY_PART_ALIASES[word(follower) ?? ""]
  ) {
    return null;
  }
  let length = the + 1;
  let months = 0;
  if (
    is(tokens[i + length], "of") &&
    is(tokens[i + length + 1], "next") &&
    is(tokens[i + length + 2], "month")
  ) {
    months = 1;
    length += 3;
  } else if (
    is(tokens[i + length], "next") &&
    is(tokens[i + length + 1], "month")
  ) {
    months = 1;
    length += 2;
  } else if (
    is(tokens[i + length], "of") &&
    is(tokens[i + length + 1], "this", "the") &&
    is(tokens[i + length + 2], "month")
  ) {
    length += 3;
  }
  return { length, value: { day: value, months, type: "monthDay" } };
}

/** "friday", "this fri", "next tuesday", "the friday after next". */
function readWeekday(tokens: Token[], i: number): Read<DaySpec> {
  let at = i;
  if (is(tokens[at], "the")) {
    at += 1;
  }
  let next = false;
  let after = false;
  if (is(tokens[at], "next", "following", "coming")) {
    next = true;
    at += 1;
  } else if (is(tokens[at], "this", "on", "upcoming")) {
    at += 1;
  }
  const weekday = WEEKDAY_INDEX.get(word(tokens[at]) ?? "");
  if (!weekday) {
    return null;
  }
  at += 1;
  if (is(tokens[at], "after") && is(tokens[at + 1], "next")) {
    after = true;
    at += 2;
  } else if (is(tokens[at], "next") && !UNITS[word(tokens[at + 1]) ?? ""]) {
    // "monday next"
    next = true;
    at += 1;
  } else if (is(tokens[at], "next", "this") && is(tokens[at + 1], "week")) {
    // "tuesday next week", "friday this week"
    const weeks = is(tokens[at], "next") ? 1 : 0;
    return {
      length: at - i + 2,
      value: { after, next, type: "weekday", weekday, weeks },
    };
  }
  return { length: at - i, value: { after, next, type: "weekday", weekday } };
}

/** today, tonight, tomorrow, the day after tomorrow, yesterday. */
function readRelative(tokens: Token[], i: number): Read<DaySpec> {
  let at = i;
  if (is(tokens[at], "the")) {
    at += 1;
  }
  if (
    is(tokens[at], "day") &&
    is(tokens[at + 1], "after") &&
    is(tokens[at + 2], "tomorrow")
  ) {
    return { length: at - i + 3, value: { days: 2, type: "relative" } };
  }
  if (is(tokens[at], "overmorrow")) {
    return { length: at - i + 1, value: { days: 2, type: "relative" } };
  }
  const days = { now: 0, today: 0, tomorrow: 1, tonight: 0, yesterday: -1 }[
    word(tokens[at]) ?? ""
  ];
  return days === undefined || at > i
    ? null
    : { length: 1, value: { days, type: "relative" } };
}

const PART_WORDS: Record<string, Part> = {
  beginning: "start",
  early: "early",
  end: "end",
  late: "late",
  mid: "mid",
  middle: "mid",
  start: "start",
};

/** Shorthand ends: "eom", "eoq", "q3 end", "month end", "the year end". */
function readPeriodEnd(tokens: Token[], i: number): Read<DaySpec> {
  const single: Record<string, DaySpec> = {
    eom: { months: 0, part: "end", type: "monthOf" },
    eoq: { quarter: null, type: "quarterEnd" },
    eow: { part: "end", type: "week", weeks: 0 },
    eoy: { part: "end", type: "yearOf", years: 0 },
    midmonth: { day: 15, months: 0, type: "monthDay" },
  };
  const direct = single[word(tokens[i]) ?? ""];
  if (direct) {
    return { length: 1, value: direct };
  }
  // q1..q4 end, end of q3
  const quarter = quarterAt(tokens, i);
  if (quarter && is(tokens[i + 1], "end")) {
    return { length: 2, value: { quarter, type: "quarterEnd" } };
  }
  // "month end", "quarter end", "year end"
  const lead = is(tokens[i], "the") ? 1 : 0;
  if (!is(tokens[i + lead + 1], "end")) {
    return null;
  }
  const ends: Record<string, DaySpec> = {
    month: { months: 0, part: "end", type: "monthOf" },
    qtr: { quarter: null, type: "quarterEnd" },
    quarter: { quarter: null, type: "quarterEnd" },
    week: { part: "end", type: "week", weeks: 0 },
    year: { part: "end", type: "yearOf", years: 0 },
  };
  const end = ends[word(tokens[i + lead]) ?? ""];
  return end ? { length: lead + 2, value: end } : null;
}

/** "the end of", "mid-", "early": the part of a period, and where its unit starts. */
function periodPartAt(tokens: Token[], i: number): { at: number; part: Part } {
  let at = i;
  if (is(tokens[at], "the")) {
    at += 1;
  }
  const part = PART_WORDS[word(tokens[at]) ?? ""];
  if (!part) {
    return { at, part: "whole" };
  }
  at += 1;
  if (is(tokens[at], "-")) {
    at += 1;
  }
  if (is(tokens[at], "of")) {
    at += 1;
  }
  if (is(tokens[at], "the")) {
    at += 1;
  }
  return { at, part };
}

/** "early next week", "end of the month", "this weekend", "mid november". */
function readPeriodPart(tokens: Token[], i: number): Read<DaySpec> {
  const lead = is(tokens[i], "the") ? 1 : 0;
  const { at: partEnd, part } = periodPartAt(tokens, i);
  let at = partEnd;
  const endQuarter = part === "end" ? quarterAt(tokens, at) : null;
  if (endQuarter || (part === "end" && is(tokens[at], "quarter"))) {
    return {
      length: at - i + 1,
      value: { quarter: endQuarter, type: "quarterEnd" },
    };
  }
  let offset = 0;
  let qualified = part !== "whole";
  if (is(tokens[at], "next", "following", "coming")) {
    offset = 1;
    at += 1;
    qualified = true;
  } else if (is(tokens[at], "this", "current")) {
    at += 1;
    qualified = true;
  }
  const unit = word(tokens[at]);
  // "recital week", "the month": not a date on their own.
  if (!qualified && unit !== "weekend" && !(lead && unit === "weekend")) {
    return null;
  }
  const period = periodOf(tokens, at, part, offset);
  return period && { length: at - i + period.length, value: period.value };
}

/** The period named by the unit word at `at`, `offset` periods ahead. */
function periodOf(
  tokens: Token[],
  at: number,
  part: Part,
  offset: number
): Read<DaySpec> {
  const unit = word(tokens[at]);
  if (unit === "weekend" || unit === "weekends") {
    return {
      length: 1,
      value: { part: "weekend", type: "week", weeks: offset },
    };
  }
  if (unit === "week") {
    return { length: 1, value: { part, type: "week", weeks: offset } };
  }
  if (unit === "month") {
    return { length: 1, value: { months: offset, part, type: "monthOf" } };
  }
  if (unit === "year") {
    return { length: 1, value: { part, type: "yearOf", years: offset } };
  }
  if (unit === "day" && part === "end") {
    return { length: 1, value: { days: 0, type: "relative" } };
  }
  const month = MONTH_INDEX.get(unit ?? "");
  // "mid november", "end of october", "early dec" (a bare month is handled in readMonth).
  if (month && part !== "whole") {
    const year = yearAt(tokens, at + 1);
    return {
      length: 1 + (year?.length ?? 0),
      value: { month, part, type: "month", year: year?.value ?? null },
    };
  }
  return null;
}

function quarterAt(tokens: Token[], i: number) {
  const text = word(tokens[i]) ?? "";
  const match = QUARTER.exec(text);
  return match ? Number(match[1]) : null;
}

/** "november", "in november", "nov 2027", "next month" is a period. */
function readMonth(tokens: Token[], i: number): Read<DaySpec> {
  const lead = is(tokens[i], "in", "this", "next") ? 1 : 0;
  const month = MONTH_INDEX.get(word(tokens[i + lead]) ?? "");
  // "may" alone is too often the verb or a name.
  if (!month || (month === 5 && !lead && !yearAt(tokens, i + 1))) {
    return null;
  }
  const year = yearAt(tokens, i + lead + 1);
  return {
    length: lead + 1 + (year?.length ?? 0),
    value: { month, part: "whole", type: "month", year: year?.value ?? null },
  };
}

/** "1st and 3rd", "last", "2nd & final": the ordinals of a month rule. */
function ordinalListAt(tokens: Token[], i: number): Read<number[]> {
  let at = i;
  const nths: number[] = [];
  for (;;) {
    const nth = is(tokens[at], "final") ? -1 : ordinalAt(tokens[at], true);
    if (nth === null || nth > 31) {
      break;
    }
    nths.push(nth);
    at += 1;
    if (
      is(tokens[at], "and", "&", ",", "+") &&
      (is(tokens[at + 1], "final") || ordinalAt(tokens[at + 1], true) !== null)
    ) {
      at += 1;
      continue;
    }
    break;
  }
  return nths.length > 0 ? { length: at - i, value: nths } : null;
}

/** What kind of day follows the ordinals: a weekday, business day, weekend, "day", or nothing. */
function nthKindAt(
  tokens: Token[],
  i: number
): {
  bare: boolean;
  business: boolean;
  length: number;
  weekday: number | null;
} {
  const weekday = WEEKDAY_INDEX.get(word(tokens[i]) ?? "");
  if (weekday) {
    return { bare: false, business: false, length: 1, weekday };
  }
  if (
    is(tokens[i], "business", "work", "working") &&
    is(tokens[i + 1], "day")
  ) {
    return { bare: false, business: true, length: 2, weekday: null };
  }
  if (is(tokens[i], "weekday")) {
    return { bare: false, business: true, length: 1, weekday: null };
  }
  if (is(tokens[i], "weekend")) {
    return { bare: false, business: false, length: 1, weekday: 6 };
  }
  if (is(tokens[i], "day")) {
    return { bare: false, business: false, length: 1, weekday: null };
  }
  return { bare: true, business: false, length: 0, weekday: null };
}

/** "of next month", "of october", "of each month": which month a rule is in. */
function nthMonthAt(
  tokens: Token[],
  i: number
): { length: number; month: MonthRef; named: boolean; repeats: boolean } {
  let month: MonthRef = { months: 0 };
  let repeats = false;
  if (!is(tokens[i], "of", "in")) {
    return { length: 0, month, named: false, repeats };
  }
  let after = i + 1;
  if (is(tokens[after], "next")) {
    month = { months: 1 };
    after += 1;
  } else if (is(tokens[after], "the", "this", "each", "every", "a")) {
    repeats = is(tokens[after], "each", "every");
    after += 1;
  }
  const byName = MONTH_INDEX.get(word(tokens[after]) ?? "");
  if (byName) {
    return {
      length: after + 1 - i,
      month: { month: byName },
      named: true,
      repeats,
    };
  }
  if (is(tokens[after], "month")) {
    return { length: after + 1 - i, month, named: true, repeats };
  }
  return { length: 0, month, named: false, repeats };
}

/**
 * Days by position in a month: "the first monday of next month", "last
 * friday of the month", "the last day of october", "2nd and 4th wednesday",
 * "first business day of each month". `requireMonth`: only with "of …
 * month" (outside monthly repeats "the 1st" is a plain day).
 */
function readNthOfMonth(
  tokens: Token[],
  i: number,
  requireMonth = true
): Read<MonthRule> {
  let at = i;
  while (is(tokens[at], "the", "on", "every", "each")) {
    at += 1;
  }
  const ordinals = ordinalListAt(tokens, at);
  if (!ordinals) {
    return null;
  }
  const nths = ordinals.value;
  at += ordinals.length;
  const { bare, business, length: kindLength, weekday } = nthKindAt(tokens, at);
  at += kindLength;
  // "first saturday each month", "1st sat ea mo"
  if (is(tokens[at], "each", "every", "a") && is(tokens[at + 1], "month")) {
    const month: MonthRef = { months: 0 };
    return {
      length: at + 2 - i,
      value: weekday
        ? { month, nths, repeats: true, type: "nthWeekday", weekday }
        : { business, month, nths, repeats: true, type: "nthDay" },
    };
  }
  const { length: ofLength, month, named, repeats } = nthMonthAt(tokens, at);
  at += ofLength;
  if (requireMonth && !named) {
    return null;
  }
  // A single bare ordinal is a plain day ("the 15th"), read elsewhere.
  if (bare && (nths.length === 1 || nths.some((nth) => nth < 1))) {
    return null;
  }
  const value: MonthRule = weekday
    ? { month, nths, repeats, type: "nthWeekday", weekday }
    : { business, month, nths, repeats, type: "nthDay" };
  return { length: at - i, value };
}

/** Holidays by name; "christmas eve", "the day after thanksgiving". */
function readHoliday(tokens: Token[], i: number): Read<DaySpec> {
  let at = i;
  if (is(tokens[at], "on", "the")) {
    at += 1;
  }
  for (const [name, words] of HOLIDAY_WORDS) {
    if (words.every((text, k) => is(tokens[at + k], text))) {
      let length = at - i + words.length;
      if (is(tokens[i + length], "day")) {
        length += 1;
      }
      if (is(tokens[i + length], "eve") && !name.endsWith("eve")) {
        return {
          length: length + 1,
          value: { name: `${name} eve`, type: "holiday" },
        };
      }
      return { length, value: { name, type: "holiday" } };
    }
  }
  return null;
}

const HOLIDAY_WORDS: [string, string[]][] = Object.keys(HOLIDAYS)
  .map((name): [string, string[]] => [name, name.split(" ")])
  .sort((a, b) => b[1].length - a[1].length);

/**
 * A clock time: "4pm", "16:30", "at 4", "noon", "half past 3", "quarter to
 * five", "nine forty five", "4 o'clock", "0800" after "at".
 */
function readTime(
  tokens: Token[],
  i: number,
  afterDay: boolean
): Read<TimeSpec> {
  const token = tokens[i];
  const lead = TIME_LEADS.has(word(token) ?? "") ? 1 : 0;
  const at = i + lead;
  const first = tokens[at];
  if (first?.kind === "time") {
    return withMeridiemWord(tokens, at, lead, {
      hour: first.hour,
      meridiem: first.meridiem,
      minute: first.minute,
    });
  }
  const text = word(first);
  if (text === "noon") {
    return { length: lead + 1, value: { hour: 12, meridiem: "24", minute: 0 } };
  }
  if (text === "midnight") {
    return { length: lead + 1, value: { hour: 0, meridiem: "24", minute: 0 } };
  }
  const relative = relativeClock(tokens, at);
  if (relative) {
    return { length: lead + relative.length, value: relative.value };
  }
  const number = clockNumberAt(tokens, at);
  if (!number) {
    return null;
  }
  if (number.military) {
    return militaryTime(tokens, at, lead, number);
  }
  if (number.value > 24) {
    return null;
  }
  // "by 3 november", "bis zum 3. November": a day, not 3 o'clock.
  const dot = is(tokens[at + number.length], ".") ? 1 : 0;
  if (MONTH_INDEX.has(word(tokens[at + number.length + dot]) ?? "")) {
    return null;
  }
  let length = lead + number.length;
  let minute = 0;
  // "nine forty five", "four thirty", "6 30"
  const minutes = minuteWordsAt(tokens, at + number.length);
  if (minutes) {
    minute = minutes.value;
    length += minutes.length;
  }
  const spec: TimeSpec = {
    hour: number.value,
    meridiem: number.value > 12 ? "24" : null,
    minute,
  };
  const marked = CLOCK_MARKS.has(word(tokens[i + length]) ?? "");
  // A bare number is a time after a clock lead ("at 4"), a day ("tmrw 3"),
  // with minutes ("4 30"), or with am/pm.
  // Or the start of a range ("2-3pm", "9 to 11:30").
  if (
    !(
      lead ||
      marked ||
      minutes ||
      afterDay ||
      isRangeAfter(tokens, i, length) ||
      isPartAfter(tokens, i + length)
    )
  ) {
    return null;
  }
  return withMeridiemWord(tokens, i + length - 1, 0, spec, length);
}

/** Military "0800", "1530" (and "2030" only after "at": 2030 is a year). */
function militaryTime(
  tokens: Token[],
  at: number,
  lead: number,
  number: ClockNumber
): Read<TimeSpec> {
  const hour = Math.floor(number.value / 100);
  const minute = number.value % 100;
  if (
    hour <= 23 &&
    minute <= 59 &&
    (lead || number.digits.startsWith("0") || hour < 20)
  ) {
    return withMeridiemWord(tokens, at + number.length - 1, lead, {
      hour,
      meridiem: "24",
      minute,
    });
  }
  return null;
}

/** Whether the bare hour read from `i` (`length` tokens) starts a range ("2-3pm", "between 2 and 4"). */
function isRangeAfter(tokens: Token[], i: number, length: number) {
  const following = word(tokens[i + length]);
  return (
    (RANGE_WORDS.has(following ?? "") || following === "till") &&
    (following !== "and" || i === 0 || is(tokens[i - 1], "between")) &&
    readTime(tokens, i + length + 1, true) !== null
  );
}

/** "quarter to 5", "half past 3", "10 past 4", "half nine", "twenty to six". */
function relativeClock(tokens: Token[], i: number): Read<TimeSpec> {
  const amount = clockMinutesAt(tokens, i);
  if (!amount) {
    return null;
  }
  const { length, value: minutes } = amount;
  const toward = is(tokens[i + length], "to", "til", "till", "before");
  const past = is(tokens[i + length], "past", "after");
  const hourAt = i + length + (toward || past ? 1 : 0);
  // "ten to midnight", "quarter past noon"
  if ((toward || past) && is(tokens[hourAt], "midnight", "noon")) {
    const base = is(tokens[hourAt], "noon") ? 12 * 60 : 24 * 60;
    const total = (base + (toward ? -minutes : minutes)) % (24 * 60);
    return {
      length: hourAt + 1 - i,
      value: {
        hour: Math.floor(total / 60),
        meridiem: "24",
        minute: total % 60,
      },
    };
  }
  const hour = clockNumberAt(tokens, hourAt);
  if (!hour || hour.military || hour.value < 1 || hour.value > 12) {
    return null;
  }
  // British "half nine" is 9:30; "half past" likewise.
  if (!(toward || past) && minutes !== 30) {
    return null;
  }
  const value: TimeSpec = toward
    ? {
        hour: hour.value === 1 ? 12 : hour.value - 1,
        meridiem: null,
        minute: 60 - minutes,
      }
    : { hour: hour.value, meridiem: null, minute: minutes };
  return withMeridiemWord(
    tokens,
    hourAt + hour.length - 1,
    0,
    value,
    hourAt + hour.length - i
  );
}

/** The minutes before an hour: "half", "quarter", "a quarter", "10 past", "twenty to". */
function clockMinutesAt(tokens: Token[], i: number): Read<number> {
  if (is(tokens[i], "half")) {
    return { length: 1, value: 30 };
  }
  if (is(tokens[i], "quarter")) {
    return { length: 1, value: 15 };
  }
  if (is(tokens[i], "a") && is(tokens[i + 1], "quarter")) {
    return { length: 2, value: 15 };
  }
  const number = numberAt(tokens, i);
  const hour = clockNumberAt(tokens, i + (number?.length ?? 0) + 1);
  // Digits before a later hour are a range ("5 to 6"), not 5:55.
  const range =
    tokens[i]?.kind === "number" &&
    hour !== null &&
    (number?.value ?? 0) < hour.value;
  if (
    number &&
    number.value < 60 &&
    !range &&
    is(
      tokens[i + number.length],
      "past",
      "to",
      "after",
      "til",
      "till",
      "before"
    )
  ) {
    return number;
  }
  return null;
}

interface ClockNumber {
  digits: string;
  length: number;
  military: boolean;
  value: number;
}

/** An hour number: digits or words; 3-4 digits are military times. */
function clockNumberAt(tokens: Token[], i: number): ClockNumber | null {
  const token = tokens[i];
  if (token?.kind === "number" && !token.ordinal) {
    return {
      digits: token.digits,
      length: 1,
      military: token.digits.length >= 3,
      value: token.value,
    };
  }
  const text = word(token);
  const value = text === null ? undefined : NUMBER_WORDS[text];
  if (
    value === undefined ||
    value < 1 ||
    value > 12 ||
    text === "a" ||
    text === "an"
  ) {
    return null;
  }
  return { digits: String(value), length: 1, military: false, value };
}

function minuteWordsAt(tokens: Token[], i: number): Read<number> {
  const token = tokens[i];
  // "6 30", "four 15"
  if (
    token?.kind === "number" &&
    !token.ordinal &&
    token.digits.length === 2 &&
    token.value < 60
  ) {
    return { length: 1, value: token.value };
  }
  if (is(token, "oh", "o") && tokens[i + 1]) {
    const digit = numberAt(tokens, i + 1);
    return digit && digit.value < 10
      ? { length: 1 + digit.length, value: digit.value }
      : null;
  }
  const text = word(token);
  if (text === null) {
    return null;
  }
  const hyphen = is(tokens[i + 1], "-") ? 1 : 0;
  const pair = `${text} ${word(tokens[i + 1 + hyphen]) ?? ""}`;
  if (MINUTE_WORDS[pair] !== undefined) {
    return { length: 2 + hyphen, value: MINUTE_WORDS[pair] };
  }
  const value = MINUTE_WORDS[text];
  if (value !== undefined && text !== "five" && text !== "ten") {
    return { length: 1, value };
  }
  return text === "oclock" ? { length: 1, value: 0 } : null;
}

function isPartAfter(tokens: Token[], i: number) {
  let at = i;
  if (is(tokens[at], "in") && is(tokens[at + 1], "the")) {
    at += 2;
  }
  return (
    DAY_PART_ALIASES[word(tokens[at]) ?? ""] !== undefined ||
    is(tokens[at], "tonight", "today", "tomorrow")
  );
}

/** Applies a following "am"/"pm"/"oclock"/"ish"/"sharp" word. */
function withMeridiemWord(
  tokens: Token[],
  last: number,
  lead: number,
  spec: TimeSpec,
  length = lead + 1
): Read<TimeSpec> {
  let total = length;
  let value = spec;
  let next = last + 1;
  // "4:30 pm", "nine am"
  while (
    is(tokens[next], "am", "pm", "oclock", "ish", "sharp", "hrs", "h", "hours")
  ) {
    const text = word(tokens[next]);
    if (
      (text === "hours" || text === "hrs" || text === "h") &&
      value.meridiem !== "24"
    ) {
      break;
    }
    if ((text === "am" || text === "pm") && value.meridiem !== "24") {
      if (value.hour < 1 || value.hour > 12) {
        return null;
      }
      value = { ...value, meridiem: text };
    }
    total += 1;
    next += 1;
  }
  return { length: total, value };
}

/** A time zone after a time: "PT", "EST", "london time", "NY time". */
function readZone(tokens: Token[], i: number): Read<string> {
  const text = word(tokens[i]) ?? "";
  const zone = ZONES[text];
  if (zone) {
    return { length: is(tokens[i + 1], "time") ? 2 : 1, value: zone };
  }
  const city = CITY_ZONES[text];
  if (city && is(tokens[i + 1], "time")) {
    return { length: 2, value: city };
  }
  return null;
}

function emptyRepeat(freq: RepeatSpec["freq"], interval = 1): RepeatSpec {
  return {
    byDay: [],
    byMonthDay: null,
    count: null,
    freq,
    interval,
    monthRule: null,
    span: null,
    unsupported: false,
    until: null,
  };
}

/** A list of weekdays: "mon, wed and fri", "tues + thurs", "mon-fri". */
function readWeekdayList(tokens: Token[], i: number): Read<number[]> {
  const days: number[] = [];
  let at = i;
  let last = i;
  while (at < tokens.length) {
    const text = word(tokens[at]) ?? "";
    const day = WEEKDAY_INDEX.get(text) ?? PLURAL_WEEKDAYS.get(text);
    if (day) {
      // "mon-fri", "monday through friday": a span of days.
      const previous = days.at(-1);
      if (previous && is(tokens[at - 1], "-", "–", "through", "to", "thru")) {
        for (let d = previous + 1; d <= day; d += 1) {
          days.push(d);
        }
      } else {
        days.push(day);
      }
      at += 1;
      last = at;
      continue;
    }
    if (
      days.length > 0 &&
      is(
        tokens[at],
        ",",
        "and",
        "&",
        "+",
        "/",
        "-",
        "–",
        "through",
        "to",
        "or",
        "thru"
      )
    ) {
      at += 1;
      continue;
    }
    break;
  }
  return days.length > 0
    ? { length: last - i, value: [...new Set(days)] }
    : null;
}

/** Shorthand day sets: "m/w/f", "mwf", "t/th", "tth", "m-f", "weekdays". */
function readDaySet(tokens: Token[], i: number): Read<number[]> {
  const text = word(tokens[i]) ?? "";
  const sets: Record<string, number[]> = {
    mwf: [1, 3, 5],
    tth: [2, 4],
    tr: [2, 4],
    weekday: WORKDAYS,
    weekdays: WORKDAYS,
    weekends: [6, 7],
    weeknight: WORKDAYS,
    weeknights: WORKDAYS,
    workdays: WORKDAYS,
  };
  if (sets[text]) {
    return { length: 1, value: sets[text] };
  }
  if (
    is(tokens[i], "school", "business", "work", "working") &&
    is(tokens[i + 1], "days", "day", "nights")
  ) {
    return { length: 2, value: WORKDAYS };
  }
  // m/w/f, t/th, m-f
  const letters: string[] = [];
  let at = i;
  while (at < tokens.length) {
    const letter = word(tokens[at]) ?? "";
    if (!["m", "t", "w", "th", "f", "s", "su", "sa"].includes(letter)) {
      break;
    }
    letters.push(letter);
    if (!is(tokens[at + 1], "/", "-")) {
      at += 1;
      break;
    }
    at += 2;
  }
  if (letters.length >= 2) {
    if (letters.join("-") === "m-f") {
      return { length: at - i, value: WORKDAYS };
    }
    const map: Record<string, number> = {
      f: 5,
      m: 1,
      sa: 6,
      s: 6,
      su: 7,
      t: 2,
      th: 4,
      w: 3,
    };
    return { length: at - i, value: letters.map((letter) => map[letter] ?? 1) };
  }
  return null;
}

type RepeatRead = Read<{ repeat: RepeatSpec; time?: DayPart }>;

/** The frequency a clinical-style unit letter means: "d", "w"/"wk", "m". */
const CLINICAL_FREQUENCIES: Record<string, RepeatSpec["freq"]> = {
  d: "DAILY",
  m: "MONTHLY",
  w: "WEEKLY",
};

/**
 * "every …", "each …", "daily", "biweekly", "mondays", "weekdays at 9",
 * "the 1st of every month", "q2 weeks".
 */
function readRepeat(
  tokens: Token[],
  i: number,
  repeating: boolean
): RepeatRead {
  const text = word(tokens[i]) ?? "";
  const simple =
    readFrequencyWord(text) ??
    readClinicalRepeat(tokens, i) ??
    readOncePer(tokens, i);
  if (simple) {
    return simple;
  }
  // "twice a week": more than the schema holds; skip as a repeat.
  if (text === "every" || text === "each" || text === "all") {
    return readEvery(tokens, i);
  }
  return (
    readWeekdayRepeat(tokens, i) ??
    readSpanRepeat(tokens, i, repeating) ??
    readMonthlyOrdinal(tokens, i)
  );
}

/** "daily", "biweekly", "nightly" (which also says when). */
function readFrequencyWord(text: string): RepeatRead {
  const frequency = FREQUENCY_WORDS[text];
  if (!frequency) {
    return null;
  }
  return {
    length: 1,
    value: {
      repeat: emptyRepeat(...frequency),
      time: text === "nightly" ? "night" : undefined,
    },
  };
}

/** q2 weeks, q3d, q14d */
function readClinicalRepeat(tokens: Token[], i: number): RepeatRead {
  const clinical = CLINICAL_REPEAT.exec(word(tokens[i]) ?? "");
  if (!clinical) {
    return null;
  }
  const unit = clinical[2] ?? word(tokens[i + 1]);
  const freq = CLINICAL_FREQUENCIES[unit?.[0] ?? ""];
  if (!freq) {
    return null;
  }
  return {
    length: clinical[2] ? 1 : 2,
    value: { repeat: emptyRepeat(freq, Number(clinical[1])) },
  };
}

/** "once a week", "once per month" */
function readOncePer(tokens: Token[], i: number): RepeatRead {
  if (
    !(is(tokens[i], "once") && is(tokens[i + 1], "a", "per", "every", "each"))
  ) {
    return null;
  }
  const freq = unitFrequency(UNITS[word(tokens[i + 2]) ?? ""]);
  return freq ? { length: 3, value: { repeat: emptyRepeat(freq) } } : null;
}

/** "mondays", "tuesdays and thursdays", "on weekdays", "weekday mornings" */
function readWeekdayRepeat(tokens: Token[], i: number): RepeatRead {
  const lead = is(tokens[i], "on") ? 1 : 0;
  const plural = PLURAL_WEEKDAYS.get(word(tokens[i + lead]) ?? "");
  const set = readDaySet(tokens, i + lead);
  const list = plural ? readWeekdayList(tokens, i + lead) : set;
  if (!list) {
    return null;
  }
  const repeat = emptyRepeat("WEEKLY");
  repeat.byDay = list.value;
  const nights = is(tokens[i + lead], "weeknights", "weeknight");
  return {
    length: lead + list.length,
    value: { repeat, time: nights ? "night" : undefined },
  };
}

/** Inside a repeat span (after an "every" outside it): "[R:12 hours]", "[R:mon, wed]". */
function readSpanRepeat(
  tokens: Token[],
  i: number,
  repeating: boolean
): RepeatRead {
  if (!repeating) {
    return null;
  }
  if (i === 0) {
    const amount = amountAt(tokens, i);
    const unit = amount
      ? UNITS[word(tokens[i + amount.length]) ?? ""]
      : undefined;
    if (amount && unit && Number.isInteger(amount.value)) {
      const freq = unitFrequency(unit);
      const repeat = emptyRepeat(freq ?? "DAILY", amount.value);
      repeat.unsupported = freq === null;
      return { length: amount.length + 1, value: { repeat } };
    }
  }
  const lead = is(tokens[i], "on") ? 1 : 0;
  const list = readWeekdayList(tokens, i + lead);
  if (!list) {
    return null;
  }
  const repeat = emptyRepeat("WEEKLY");
  repeat.byDay = list.value;
  return { length: lead + list.length, value: { repeat } };
}

/** "the 1st of every month", "15th of each month" */
function readMonthlyOrdinal(tokens: Token[], i: number): RepeatRead {
  const lead = is(tokens[i], "the", "on") ? 1 : 0;
  const ordinal = ordinalAt(tokens[i + lead]);
  if (ordinal === null || ordinal <= 0) {
    return null;
  }
  let at = i + lead + 1;
  if (is(tokens[at], "of")) {
    at += 1;
  }
  if (!(is(tokens[at], "every", "each") && is(tokens[at + 1], "month"))) {
    return null;
  }
  const repeat = emptyRepeat("MONTHLY");
  repeat.byMonthDay = ordinal;
  return { length: at + 2 - i, value: { repeat } };
}

function unitFrequency(unit: Unit | undefined): RepeatSpec["freq"] | null {
  switch (unit) {
    case "day":
      return "DAILY";
    case "week":
      return "WEEKLY";
    case "month":
      return "MONTHLY";
    case "year":
      return "YEARLY";
    default:
      return null;
  }
}

/** "every other", "every 2nd week", "every 3": the interval and how many tokens say it. */
function everyIntervalAt(
  tokens: Token[],
  at: number
): { interval: number; length: number } {
  if (
    is(tokens[at], "other") ||
    (ordinalAt(tokens[at]) === 2 &&
      !is(tokens[at + 1], "of") &&
      (WEEKDAY_INDEX.has(word(tokens[at + 1]) ?? "") ||
        UNITS[word(tokens[at + 1]) ?? ""]) &&
      !is(tokens[at + 2], "of"))
  ) {
    return { interval: 2, length: 1 };
  }
  const amount = amountAt(tokens, at);
  if (amount && Number.isInteger(amount.value) && !is(tokens[at], "a", "an")) {
    return { interval: amount.value, length: amount.length };
  }
  return { interval: 1, length: 0 };
}

/** "every 3rd thursday", "every 1st and 15th", "every 15th": monthly rules after "every". */
function readEveryOrdinal(tokens: Token[], i: number, at: number): RepeatRead {
  const day = ordinalAt(tokens[at], true);
  if (day === null) {
    return null;
  }
  const rule = readNthOfMonth(tokens, at, false);
  if (rule) {
    const repeat = emptyRepeat("MONTHLY");
    repeat.monthRule = rule.value;
    return { length: at - i + rule.length, value: { repeat } };
  }
  // "every 15th": monthly on that day.
  if (day > 0) {
    const repeat = emptyRepeat("MONTHLY");
    repeat.byMonthDay = day;
    return { length: at - i + 1, value: { repeat } };
  }
  return null;
}

/** After "every"/"each": the interval and what repeats. */
function readEvery(tokens: Token[], i: number): RepeatRead {
  const { interval, length } = everyIntervalAt(tokens, i + 1);
  if (length === 0) {
    const ordinal = readEveryOrdinal(tokens, i, i + 1);
    if (ordinal) {
      return ordinal;
    }
  }
  return readEveryUnit(tokens, i, i + 1 + length, interval);
}

/** What repeats after "every [interval]": a unit, day part, day set or date. */
function readEveryUnit(
  tokens: Token[],
  i: number,
  at: number,
  interval: number
): RepeatRead {
  // "every last friday of the month", "each first business day of the month"
  const nth = readNthOfMonth(tokens, at);
  if (nth) {
    const repeat = emptyRepeat("MONTHLY");
    repeat.monthRule = nth.value;
    return { length: at - i + nth.length, value: { repeat } };
  }
  const text = word(tokens[at]) ?? "";
  const unit = UNITS[text];
  if (unit === "hour" || unit === "minute") {
    const repeat = emptyRepeat("DAILY");
    repeat.unsupported = true;
    return { length: at - i + 1, value: { repeat } };
  }
  const freq = unitFrequency(unit);
  if (freq) {
    return {
      length: at - i + 1,
      value: { repeat: emptyRepeat(freq, interval) },
    };
  }
  if (text === "fortnight") {
    return {
      length: at - i + 1,
      value: { repeat: emptyRepeat("WEEKLY", 2 * interval) },
    };
  }
  // "every morning", "every night", "every weekday morning"
  const part = DAY_PART_ALIASES[text];
  if (part) {
    return {
      length: at - i + 1,
      value: { repeat: emptyRepeat("DAILY", interval), time: part },
    };
  }
  const set = readDaySet(tokens, at) ?? readWeekdayList(tokens, at);
  if (set) {
    const repeat = emptyRepeat("WEEKLY", interval);
    repeat.byDay = set.value;
    return { length: at - i + set.length, value: { repeat } };
  }
  // "every weekend"
  if (text === "weekend") {
    const repeat = emptyRepeat("WEEKLY", interval);
    repeat.byDay = [6, 7];
    return { length: at - i + 1, value: { repeat } };
  }
  // "every year on march 3", "every march 3", "every 15th"
  const date = readCalendarDate(tokens, at);
  if (date && date.value.type === "date") {
    const repeat = emptyRepeat("YEARLY", interval);
    return { length: at - i + date.length, value: { repeat } };
  }
  return null;
}

/** Reads a whole phrase. */
export function parsePhrase(tokens: Token[], repeating = false): Phrase {
  const phrase: Phrase = {
    day: null,
    end: null,
    noTime: false,
    part: null,
    today: false,
    vague: false,
    weekendOf: false,
    relative: false,
    repeat: null,
    shift: 0,
    start: null,
    time: null,
    zone: null,
  };
  const reader: Reader = { repeating, tokens };
  let marker: Marker = null;
  let i = 0;
  while (i < tokens.length) {
    const consumed = step(reader, phrase, i, marker);
    if (consumed.length > 0) {
      marker = consumed.marker;
      i += consumed.length;
    } else {
      // Punctuation keeps a pending marker, and "until"/"starting" reach
      // past other words ("until my exam on december 8").
      if (
        tokens[i]?.kind !== "symbol" &&
        marker !== "until" &&
        marker !== "start"
      ) {
        marker = null;
      }
      i += 1;
    }
  }
  return phrase;
}

type Marker = "start" | "until" | "range" | null;

/** How many tokens an expression used, and the marker it leaves for the next. */
interface Consumed {
  length: number;
  marker: Marker;
}

/** Reads one kind of expression at `i`, updating `phrase`; null when it isn't there. */
type Step = (
  reader: Reader,
  phrase: Phrase,
  i: number,
  marker: Marker
) => Consumed | null;

/** What can come after "7 days after": completion, not a date. */
const COMPLETION_WORDS = [
  "i",
  "completion",
  "completing",
  "finishing",
  "done",
  "it",
  "each",
  "every",
  "last",
  "marking",
  "the",
  "my",
];
const MEAL_WORDS = [
  "lunch",
  "lunchtime",
  "dinner",
  "breakfast",
  "work",
  "school",
  "bed",
  "class",
];
/** Words that join date expressions without saying anything themselves. */
const FILLER_WORDS = new Set([
  "this",
  "on",
  "at",
  "the",
  "in",
  "of",
  "by",
  "due",
  "before",
  "after",
  "around",
  "about",
  "and",
  "next",
  "every",
  "starting",
]);

/**
 * "7 days after i finish", "3 wks after I mark it done": counted from
 * completion, which the schema can't hold.
 */
const readCompletionGap: Step = ({ tokens }, phrase, i) => {
  const gap = amountAt(tokens, i);
  if (
    !(
      gap &&
      UNITS[word(tokens[i + gap.length]) ?? ""] &&
      is(tokens[i + gap.length + 1], "after", "from") &&
      is(tokens[i + gap.length + 2], ...COMPLETION_WORDS)
    )
  ) {
    return null;
  }
  phrase.relative = true;
  let end = i;
  while (end < tokens.length && !START_WORDS.has(word(tokens[end]) ?? "")) {
    end += 1;
  }
  return { length: end - i, marker: null };
};

/** "the week after next": two weeks out. */
const readWeekAfterNext: Step = ({ tokens }, phrase, i, marker) => {
  const the = is(tokens[i], "the") ? 1 : 0;
  if (
    !(
      is(tokens[i + the], "week") &&
      is(tokens[i + the + 1], "after") &&
      is(tokens[i + the + 2], "next")
    )
  ) {
    return null;
  }
  placeDay(phrase, { amount: 14, type: "offset", unit: "day" }, marker);
  return { length: the + 3, marker: null };
};

/** "later this week": no day to put it on (a repeat runs until then). */
const readLaterThis: Step = ({ tokens }, phrase, i) => {
  if (
    !(
      is(tokens[i], "later") &&
      is(tokens[i + 1], "this") &&
      is(tokens[i + 2], "week", "month")
    )
  ) {
    return null;
  }
  if (phrase.repeat) {
    phrase.repeat.until ??= is(tokens[i + 2], "week")
      ? { part: "end", type: "week", weeks: 0 }
      : { months: 0, part: "end", type: "monthOf" };
  } else {
    phrase.vague = true;
  }
  return { length: 3, marker: null };
};

/** "after lunch" is 13:00; "before lunch", "after dinner" say no time. */
const readMeal: Step = ({ tokens }, phrase, i) => {
  if (!(is(tokens[i], "after", "before") && is(tokens[i + 1], ...MEAL_WORDS))) {
    return null;
  }
  const lunch = is(tokens[i + 1], "lunch", "lunchtime");
  if (lunch && is(tokens[i], "after")) {
    phrase.time ??= { hour: 13, meridiem: "24", minute: 0 };
    // Alone, it says when in a day, not which day.
    phrase.vague =
      phrase.vague || (phrase.day === null && i === 0 && tokens.length === 2);
  } else if (lunch) {
    phrase.noTime = true;
  }
  return { length: 2, marker: null };
};

/** "starting", "until", "up to": where the next day goes. */
const readMarker: Step = (reader, phrase, i) => {
  const { tokens } = reader;
  const text = word(tokens[i]);
  if (
    text !== null &&
    START_WORDS.has(text) &&
    !(
      text === "from" &&
      phrase.time === null &&
      readTime(tokens, i + 1, true) !== null
    )
  ) {
    return { length: 1, marker: "start" };
  }
  if (
    text !== null &&
    UNTIL_WORDS.has(text) &&
    (phrase.repeat || reader.repeating)
  ) {
    const up = is(tokens[i + 1], "on", "to") ? 1 : 0;
    return { length: 1 + up, marker: "until" };
  }
  if (text === "up" && is(tokens[i + 1], "to", "until") && phrase.repeat) {
    return { length: 2, marker: "until" };
  }
  return null;
};

/** How long a repeat runs: "for 2 weeks", "for 6 sessions", "10 times", "x10". */
const readRepeatLength: Step = ({ tokens }, phrase, i) => {
  if (!phrase.repeat) {
    return null;
  }
  if (is(tokens[i], "for", "x")) {
    const span = readSpan(tokens, i + 1);
    if (span) {
      if (span.value.unit === "times") {
        phrase.repeat.count = span.value.amount;
      } else {
        phrase.repeat.span = {
          amount: span.value.amount,
          unit: span.value.unit,
        };
      }
      return { length: 1 + span.length, marker: null };
    }
  }
  const times = readTimes(tokens, i);
  if (times) {
    phrase.repeat.count = times.value;
    return { length: times.length, marker: null };
  }
  return null;
};

/** A repeat rule, or (in a monthly repeat) "on the last day", "2nd and 4th wed". */
const readRepeatRule: Step = (reader, phrase, i) => {
  const { tokens } = reader;
  const repeat = readRepeat(tokens, i, reader.repeating);
  if (repeat) {
    mergeRepeat(phrase, repeat.value.repeat);
    if (repeat.value.time && !phrase.part) {
      phrase.part = repeat.value.time;
    }
    return { length: repeat.length, marker: null };
  }
  if (phrase.repeat?.freq === "MONTHLY" && !phrase.repeat.monthRule) {
    const rule = readNthOfMonth(tokens, i, false);
    if (rule) {
      phrase.repeat.monthRule = rule.value;
      return { length: rule.length, marker: null };
    }
  }
  return null;
};

/** "a week from tuesday", "3 days after christmas", "the day before" */
const readDayShift: Step = ({ tokens }, phrase, i) => {
  const shift = readShift(tokens, i);
  if (!shift) {
    return null;
  }
  phrase.shift += shift.value;
  return { length: shift.length, marker: null };
};

/** After a time: its zone ("3pm ET") or a range end ("2-4pm", "10 till noon"). */
const readAfterTime: Step = ({ tokens }, phrase, i) => {
  if (!phrase.time) {
    return null;
  }
  const zone = readZone(tokens, i);
  if (zone) {
    phrase.zone = zone.value;
    return { length: zone.length, marker: null };
  }
  const text = word(tokens[i]) ?? "";
  if (phrase.end || !(RANGE_WORDS.has(text) || text === "till")) {
    return null;
  }
  const end = readTime(tokens, i + 1, true);
  if (!end) {
    return null;
  }
  phrase.end = end.value;
  return { length: 1 + end.length, marker: null };
};

/** A clock time; the second one after "from"/"between" ends a range. */
const readClock: Step = ({ tokens }, phrase, i, marker) => {
  const time = readTime(tokens, i, phrase.day !== null || marker === "start");
  if (!time) {
    return null;
  }
  if (!phrase.time) {
    phrase.time = time.value;
  } else if (!phrase.end && marker === "range") {
    phrase.end = time.value;
  }
  if (is(tokens[i], "from", "between") && !phrase.end) {
    return { length: time.length, marker: "range" };
  }
  return { length: time.length, marker: null };
};

/** A day, placed by the marker before it. */
const readDayStep: Step = ({ tokens }, phrase, i, marker) => {
  const day = readDay(tokens, i);
  if (!day) {
    return null;
  }
  if (
    (day.value.type === "nthWeekday" || day.value.type === "nthDay") &&
    day.value.repeats &&
    marker !== "until" &&
    marker !== "start"
  ) {
    // "the first tuesday of each month": a monthly rule the schema can't hold.
    const monthly = emptyRepeat("MONTHLY");
    monthly.monthRule = day.value;
    mergeRepeat(phrase, monthly);
    return { length: day.length, marker: null };
  }
  placeDay(phrase, day.value, marker);
  // "labor day weekend", "july 4th weekend"
  if (is(tokens[i + day.length], "weekend") && day.value.type !== "week") {
    phrase.weekendOf = true;
    return { length: day.length + 1, marker: null };
  }
  if (word(tokens[i + day.length - 1]) === "tonight") {
    phrase.part ??= "night";
  }
  return { length: day.length, marker: null };
};

/** Day parts: "morning", "in the evening", "tonight" (also a day). */
const readDayPart: Step = ({ tokens }, phrase, i) => {
  const part = readPart(tokens, i);
  if (!part) {
    return null;
  }
  phrase.part = part.value;
  if (is(tokens[i], "this")) {
    phrase.today = true;
  }
  if (word(tokens[i + part.length - 1]) === "tonight" && !phrase.day) {
    phrase.day = { days: 0, type: "relative" };
  }
  return { length: part.length, marker: null };
};

/** "eod", "first thing", "lunch", "dinner". */
const readDayWord: Step = ({ tokens }, phrase, i) => {
  const text = word(tokens[i]);
  if (text === "eod" || text === "eob") {
    phrase.day ??= { days: 0, type: "relative" };
    phrase.noTime = true;
    return { length: 1, marker: null };
  }
  if (text === "first" && is(tokens[i + 1], "thing")) {
    phrase.part = "morning";
    const length =
      is(tokens[i + 2], "in") && is(tokens[i + 4], "morning") ? 5 : 2;
    return { length, marker: null };
  }
  if (text === "lunch" || text === "lunchtime") {
    phrase.time ??= { hour: 12, meridiem: "24", minute: 0 };
    return { length: 1, marker: null };
  }
  if (text === "dinner" || text === "breakfast") {
    return { length: 1, marker: null };
  }
  return null;
};

/** A phrase that is just a number: a day ("antes del 30") or an hour ("[S:6]"). */
const readLoneNumber: Step = ({ tokens }, phrase, i) => {
  if (tokens.length > 2) {
    return null;
  }
  // A lone day number: "by the 30th" is caught above; "antes del 30".
  const lone = tokens[i];
  if (
    lone?.kind === "number" &&
    !lone.ordinal &&
    lone.value >= 13 &&
    lone.value <= 31 &&
    lone.digits.length === 2
  ) {
    phrase.day = { day: lone.value, months: 0, type: "monthDay" };
    return { length: 1, marker: null };
  }
  // A lone hour: "[U:five]", "[S:6]".
  if (phrase.time) {
    return null;
  }
  const hour = clockNumberAt(tokens, i);
  if (hour && !hour.military && hour.value >= 1 && hour.value <= 12) {
    phrase.time = { hour: hour.value, meridiem: null, minute: 0 };
    return { length: 1, marker: null };
  }
  return null;
};

/** Filler words: "before"/"after" end a pending marker, others pass it on. */
const readFiller: Step = ({ tokens }, _phrase, i, marker) => {
  const text = word(tokens[i]);
  if (text === null || !FILLER_WORDS.has(text)) {
    return null;
  }
  return {
    length: 1,
    marker: text === "before" || text === "after" ? null : marker,
  };
};

/** The readers `step` tries, in order: earlier ones win. */
const STEPS: Step[] = [
  readCompletionGap,
  readWeekAfterNext,
  readLaterThis,
  readMeal,
  readMarker,
  readRepeatLength,
  readRepeatRule,
  readDayShift,
  readAfterTime,
  readClock,
  readDayStep,
  readDayPart,
  readDayWord,
  readLoneNumber,
  readFiller,
];

/** Reads one expression at `i`; returns how many tokens it used and the marker it leaves. */
function step(
  reader: Reader,
  phrase: Phrase,
  i: number,
  marker: Marker
): Consumed {
  for (const read of STEPS) {
    const consumed = read(reader, phrase, i, marker);
    if (consumed) {
      return consumed;
    }
  }
  return { length: 0, marker: null };
}

/** "for 2 weeks", "for the next 4 weeks", "for 10 days", "for 6 sessions". */
function readSpan(
  tokens: Token[],
  i: number
): Read<{ amount: number; unit: Unit | "times" }> {
  let at = i;
  if (is(tokens[at], "the")) {
    at += 1;
  }
  if (is(tokens[at], "next")) {
    at += 1;
  }
  const amount = amountAt(tokens, at);
  if (!amount) {
    return null;
  }
  at += amount.length;
  const text = word(tokens[at]) ?? "";
  if (
    [
      "times",
      "sessions",
      "occurrences",
      "rounds",
      "classes",
      "lessons",
    ].includes(text)
  ) {
    return {
      length: at - i + 1,
      value: { amount: amount.value, unit: "times" },
    };
  }
  const unit = UNITS[text];
  if (unit && unit !== "hour" && unit !== "minute") {
    return { length: at - i + 1, value: { amount: amount.value, unit } };
  }
  if (text === "fortnight" || text === "fortnights") {
    return {
      length: at - i + 1,
      value: { amount: amount.value * 2, unit: "week" },
    };
  }
  return null;
}

function readTimes(tokens: Token[], i: number): Read<number> {
  const amount = numberAt(tokens, i);
  if (
    amount &&
    is(tokens[i + amount.length], "times", "sessions", "occurrences")
  ) {
    return { length: amount.length + 1, value: amount.value };
  }
  const text = word(tokens[i]) ?? "";
  const match = TIMES_SHORTHAND.exec(text);
  return match ? { length: 1, value: Number(match[1]) } : null;
}

/** "a week from", "2 days after", "3 days before", "the day after". */
function readShift(tokens: Token[], i: number): Read<number> {
  let at = i;
  if (is(tokens[at], "the")) {
    at += 1;
  }
  const amount = amountAt(tokens, at);
  const count = amount?.value ?? (is(tokens[at], "day", "week") ? 1 : null);
  if (count === null) {
    return null;
  }
  at += amount?.length ?? 0;
  const days = shiftUnitDays(word(tokens[at]));
  if (days === null || !Number.isInteger(count)) {
    return null;
  }
  at += 1;
  const direction = word(tokens[at]);
  // "from now"/"from today" is an offset, not a shift.
  if (direction === "from" && is(tokens[at + 1], "now", "today")) {
    return null;
  }
  if (direction !== "from" && direction !== "after" && direction !== "before") {
    return null;
  }
  // "the day after tomorrow" is read as a relative day.
  if (direction === "after" && is(tokens[at + 1], "tomorrow") && !amount) {
    return null;
  }
  const sign = direction === "before" ? -1 : 1;
  return { length: at - i + 1, value: sign * count * days };
}

/** Days in a shift's unit: "day(s)" or "week(s)". */
function shiftUnitDays(unit: string | null) {
  if (unit === "day" || unit === "days") {
    return 1;
  }
  return unit === "week" || unit === "weeks" ? 7 : null;
}

function readPart(tokens: Token[], i: number): Read<DayPart> {
  let at = i;
  if (is(tokens[at], "in", "at", "this", "during")) {
    at += 1;
  }
  if (is(tokens[at], "the")) {
    at += 1;
  }
  if (is(tokens[at], "early", "late")) {
    at += 1;
  }
  const part = DAY_PART_ALIASES[word(tokens[at]) ?? ""];
  if (part) {
    return { length: at - i + 1, value: part };
  }
  // "sat am", "tomorrow pm"
  if (is(tokens[at], "am") && at === i) {
    return { length: 1, value: "morning" };
  }
  if (is(tokens[at], "pm") && at === i) {
    return { length: 1, value: "afternoon" };
  }
  return null;
}

function readDay(tokens: Token[], i: number): Read<DaySpec> {
  return (
    readHoliday(tokens, i) ??
    readNthOfMonth(tokens, i) ??
    readCalendarDate(tokens, i) ??
    readOffset(tokens, i) ??
    readRelative(tokens, i) ??
    readWeekdayWithDate(tokens, i) ??
    readWeekday(tokens, i) ??
    readPeriodEnd(tokens, i) ??
    readPeriodPart(tokens, i) ??
    readMonthDay(tokens, i) ??
    readMonth(tokens, i)
  );
}

/** "wed 28 oct", "wednesday the 28th", "fri 10/30": the date wins. */
function readWeekdayWithDate(tokens: Token[], i: number): Read<DaySpec> {
  const weekday = WEEKDAY_INDEX.get(word(tokens[i]) ?? "");
  if (!weekday) {
    return null;
  }
  const comma = is(tokens[i + 1], ",") ? 1 : 0;
  const date =
    readCalendarDate(tokens, i + 1 + comma) ??
    readMonthDay(tokens, i + 1 + comma);
  return date ? { length: 1 + comma + date.length, value: date.value } : null;
}

/** Where a day read after a marker goes. */
function placeDay(phrase: Phrase, day: DaySpec, marker: Marker) {
  if (marker === "until") {
    if (phrase.repeat) {
      phrase.repeat.until ??= day;
    }
    return;
  }
  if (marker === "start" && (phrase.repeat || phrase.day)) {
    phrase.start ??= day;
    return;
  }
  // "every evening this week": a repeat until the week is out.
  if (phrase.repeat && day.type === "week" && day.part === "whole") {
    phrase.repeat.until ??= { part: "end", type: "week", weeks: day.weeks };
    return;
  }
  if (!phrase.day) {
    phrase.day = day;
    return;
  }
  // "next week tuesday", "来週の火曜日": that weekday in that week.
  if (
    phrase.day.type === "week" &&
    phrase.day.part === "whole" &&
    day.type === "weekday"
  ) {
    phrase.day = { ...day, weeks: phrase.day.weeks };
    return;
  }
  // A weekday followed by a more exact date ("monday, nov 9").
  if (
    phrase.day.type === "weekday" &&
    (day.type === "date" || day.type === "monthDay")
  ) {
    phrase.day = day;
  }
}

function mergeRepeat(phrase: Phrase, repeat: RepeatSpec) {
  const current = phrase.repeat;
  if (!current) {
    phrase.repeat = repeat;
    return;
  }
  // "every week on mon and thu", "monthly on the 15th"
  if (repeat.byDay.length > 0) {
    current.byDay = [...new Set([...current.byDay, ...repeat.byDay])];
    if (current.freq === "DAILY") {
      current.freq = "WEEKLY";
    }
  }
  current.byMonthDay ??= repeat.byMonthDay;
  current.monthRule ??= repeat.monthRule;
}
