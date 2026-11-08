/**
 * Whether a day is one of a recurrence rule's own occurrences, for the rule
 * parts the editors (and most calendars) write: FREQ DAILY, WEEKLY, MONTHLY
 * or YEARLY with INTERVAL, BYDAY, BYMONTHDAY, BYMONTH and WKST. Anything
 * else (BYSETPOS, BYYEARDAY, BYWEEKNO, clock parts, sub-daily frequencies)
 * isn't read: the answer is then null, "can't tell".
 */
import { Temporal } from "temporal-polyfill";

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const READ_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "WKST",
  "COUNT",
  "UNTIL",
]);
const ORDINAL_DAY = /^([+-]?\d{1,2})?([A-Z]{2})$/;

interface Rule {
  byDay: { nth: number | null; weekday: number }[];
  byMonth: number[];
  byMonthDay: number[];
  freq: string;
  interval: number;
  weekStart: number;
}

function readRule(rule: string): Rule | null {
  const parts = new Map(
    rule
      .replace("RRULE:", "")
      .split(";")
      .filter(Boolean)
      .map((part) => part.split("=") as [string, string])
  );
  if ([...parts.keys()].some((key) => !READ_PARTS.has(key))) {
    return null;
  }
  const freq = parts.get("FREQ") ?? "";
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    return null;
  }
  const list = (key: string) =>
    (parts.get(key) ?? "").split(",").filter(Boolean);
  const byDay = list("BYDAY").map((code) => {
    const match = ORDINAL_DAY.exec(code);
    return {
      nth: match?.[1] ? Number(match[1]) : null,
      weekday: WEEKDAYS.indexOf(match?.[2] ?? "") + 1,
    };
  });
  if (byDay.some((day) => day.weekday === 0)) {
    return null;
  }
  // Combinations not modeled here (an intersection like "Friday the 13th",
  // a yearly or weekly day of the month without its month) aren't read;
  // the caller then falls back to Google's list.
  const byMonthDay = list("BYMONTHDAY");
  if (
    byMonthDay.length > 0 &&
    (byDay.length > 0 ||
      freq === "WEEKLY" ||
      (freq === "YEARLY" && list("BYMONTH").length === 0))
  ) {
    return null;
  }
  return {
    byDay,
    byMonth: list("BYMONTH").map(Number),
    byMonthDay: list("BYMONTHDAY").map(Number),
    freq,
    interval: Number(parts.get("INTERVAL") ?? 1) || 1,
    weekStart: WEEKDAYS.indexOf(parts.get("WKST") ?? "MO") + 1 || 1,
  };
}

/** Whether `day` matches a BYDAY entry within its month ("2TU", "-1FR", "TU"). */
function matchesWeekdayOfMonth(
  day: Temporal.PlainDate,
  entry: { nth: number | null; weekday: number }
): boolean {
  if (day.dayOfWeek !== entry.weekday) {
    return false;
  }
  if (entry.nth === null) {
    return true;
  }
  return entry.nth > 0
    ? Math.ceil(day.day / 7) === entry.nth
    : Math.ceil((day.daysInMonth - day.day + 1) / 7) === -entry.nth;
}

/** Whether `day` is one of `rule`'s days within a month it repeats in. */
function matchesDayOfMonth(
  rule: Rule,
  day: Temporal.PlainDate,
  start: Temporal.PlainDate
): boolean {
  if (rule.byMonthDay.length > 0) {
    return rule.byMonthDay.some((n) =>
      n > 0 ? day.day === n : day.day === day.daysInMonth + 1 + n
    );
  }
  if (rule.byDay.length > 0) {
    return rule.byDay.some((entry) => matchesWeekdayOfMonth(day, entry));
  }
  return day.day === start.day;
}

function weekStartOf(day: Temporal.PlainDate, weekStart: number) {
  return day.subtract({ days: (day.dayOfWeek - weekStart + 7) % 7 });
}

/**
 * Whether `day` is one of `rule`'s days, counting from the series' `start`
 * day; null when the rule has parts not read here. Its time isn't checked
 * (the caller compares it with the series' start time), nor its end
 * (COUNT, UNTIL): see `countedRuleDays`.
 */
export function isRuleDay(
  rule: string,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean | null {
  const read = readRule(rule);
  return read ? matches(read, start, day) : null;
}

/** The longest a rule is walked looking for its days: fifty years. */
const MAX_DAYS = 366 * 50;

/**
 * A COUNT rule's days in order, its first `count` of them, walked from the
 * series' `start` day; null when the rule has parts not read here, or it
 * has no COUNT. COUNT counts these positions, skipped (EXDATE) ones
 * included and added (RDATE) ones not, so a split can say exactly how
 * many are left.
 */
export function countedRuleDays(
  rule: string,
  start: Temporal.PlainDate,
  count: number
): Temporal.PlainDate[] | null {
  const read = readRule(rule);
  if (!read) {
    return null;
  }
  const days: Temporal.PlainDate[] = [];
  for (let offset = 0; offset < MAX_DAYS && days.length < count; offset += 1) {
    const day = start.add({ days: offset });
    // The series' first start is its first occurrence, rule day or not
    // (Google counts it so).
    if (offset === 0 || matches(read, start, day)) {
      days.push(day);
    }
  }
  return days.length === count ? days : null;
}

function matches(
  read: Rule,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean | null {
  if (Temporal.PlainDate.compare(day, start) < 0) {
    return false;
  }
  if (read.byMonth.length > 0 && !read.byMonth.includes(day.month)) {
    return false;
  }
  const months = (day.year - start.year) * 12 + day.month - start.month;
  switch (read.freq) {
    case "DAILY":
      return (
        start.until(day).days % read.interval === 0 &&
        (read.byDay.length === 0 ||
          read.byDay.some((entry) => entry.weekday === day.dayOfWeek)) &&
        (read.byMonthDay.length === 0 || matchesDayOfMonth(read, day, start))
      );
    case "WEEKLY": {
      const weeks =
        weekStartOf(start, read.weekStart).until(
          weekStartOf(day, read.weekStart)
        ).days / 7;
      const weekdays =
        read.byDay.length > 0
          ? read.byDay.map((entry) => entry.weekday)
          : [start.dayOfWeek];
      return weeks % read.interval === 0 && weekdays.includes(day.dayOfWeek);
    }
    case "MONTHLY":
      return (
        months % read.interval === 0 && matchesDayOfMonth(read, day, start)
      );
    default: {
      // YEARLY: in the rule's months (or the start's), on its days.
      const inMonth =
        read.byMonth.length > 0 ? true : day.month === start.month;
      if (read.byDay.length > 0 && read.byMonth.length === 0) {
        return null;
      }
      return (
        (day.year - start.year) % read.interval === 0 &&
        inMonth &&
        matchesDayOfMonth(read, day, start)
      );
    }
  }
}
