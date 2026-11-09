/**
 * Whether a day is one of a recurrence rule's days (RFC 5545). Reads FREQ
 * DAILY to YEARLY, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS (monthly
 * or weekly), WKST, and BYHOUR / BYMINUTE / BYSECOND, which don't change
 * the days (Google meets a rule once a day and ignores a list of times).
 * Each BY part narrows the set ("Monday, the 1st to the 7th" is the first
 * Monday). Anything else (BYYEARDAY, BYWEEKNO, sub-daily rules, a yearly
 * weekday without a month) gives null: can't tell.
 */
import { Temporal } from "temporal-polyfill";

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const READ_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "WKST",
  "COUNT",
  "UNTIL",
  "BYHOUR",
  "BYMINUTE",
  "BYSECOND",
]);
const ORDINAL_DAY = /^([+-]?\d{1,2})?([A-Z]{2})$/;

interface WeekdayEntry {
  nth: number | null;
  weekday: number;
}

interface Rule {
  byDay: WeekdayEntry[];
  byMonth: number[];
  byMonthDay: number[];
  bySetPos: number[];
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
  const list = (key: string) =>
    (parts.get(key) ?? "").split(",").filter(Boolean);
  const freq = parts.get("FREQ") ?? "";
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    return null;
  }
  const byDay = list("BYDAY").map((code) => {
    const match = ORDINAL_DAY.exec(code);
    return {
      nth: match?.[1] ? Number(match[1]) : null,
      weekday: WEEKDAYS.indexOf(match?.[2] ?? "") + 1,
    };
  });
  const byMonth = list("BYMONTH").map(Number);
  const bySetPos = list("BYSETPOS").map(Number);
  const ordinals = byDay.some((entry) => entry.nth !== null);
  if (
    byDay.some((entry) => entry.weekday === 0) ||
    // A weekday of the month only means something monthly, or yearly
    // within a month; a yearly weekday without one counts through the year.
    (ordinals && (freq === "DAILY" || freq === "WEEKLY")) ||
    (freq === "YEARLY" && byDay.length > 0 && byMonth.length === 0) ||
    // BYSETPOS picks within a month or a week here.
    (bySetPos.length > 0 && freq !== "MONTHLY" && freq !== "WEEKLY")
  ) {
    return null;
  }
  return {
    byDay,
    byMonth,
    byMonthDay: list("BYMONTHDAY").map(Number),
    bySetPos,
    freq,
    interval: Number(parts.get("INTERVAL") ?? 1) || 1,
    weekStart: WEEKDAYS.indexOf(parts.get("WKST") ?? "MO") + 1 || 1,
  };
}

/** Whether `day` matches a BYDAY entry ("2TU", "-1FR", "TU") in its month. */
function matchesWeekdayOfMonth(
  day: Temporal.PlainDate,
  entry: WeekdayEntry
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

function matchesMonthDay(rule: Rule, day: Temporal.PlainDate): boolean {
  return rule.byMonthDay.some((n) =>
    n > 0 ? day.day === n : day.day === day.daysInMonth + 1 + n
  );
}

/**
 * Whether `day` passes every BY part the rule gives (BYSETPOS and the
 * period aside). A day part it doesn't give comes from `start` (RFC 5545).
 */
function passesDayParts(
  rule: Rule,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(day.month)) {
    return false;
  }
  if (rule.byMonthDay.length > 0 && !matchesMonthDay(rule, day)) {
    return false;
  }
  if (
    rule.byDay.length > 0 &&
    !rule.byDay.some((entry) => matchesWeekdayOfMonth(day, entry))
  ) {
    return false;
  }
  const namesDay = rule.byDay.length > 0 || rule.byMonthDay.length > 0;
  switch (rule.freq) {
    case "WEEKLY":
      return namesDay || day.dayOfWeek === start.dayOfWeek;
    case "MONTHLY":
      return namesDay || day.day === start.day;
    case "YEARLY":
      // A day of the month with no month is in every month.
      return (
        (rule.byMonth.length > 0 ||
          rule.byMonthDay.length > 0 ||
          day.month === start.month) &&
        (namesDay || day.day === start.day)
      );
    default:
      return true;
  }
}

function weekStartOf(day: Temporal.PlainDate, weekStart: number) {
  return day.subtract({ days: (day.dayOfWeek - weekStart + 7) % 7 });
}

/** Whether `day` is in a period (day, week, ...) the rule repeats in. */
function inRulePeriod(
  rule: Rule,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  switch (rule.freq) {
    case "DAILY":
      return start.until(day).days % rule.interval === 0;
    case "WEEKLY":
      return (
        (weekStartOf(start, rule.weekStart).until(
          weekStartOf(day, rule.weekStart)
        ).days /
          7) %
          rule.interval ===
        0
      );
    case "MONTHLY":
      return (
        ((day.year - start.year) * 12 + day.month - start.month) %
          rule.interval ===
        0
      );
    default:
      return (day.year - start.year) % rule.interval === 0;
  }
}

/** Whether `day` is at a BYSETPOS place in its month's (or week's) days. */
function atSetPosition(
  rule: Rule,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  const first =
    rule.freq === "WEEKLY"
      ? weekStartOf(day, rule.weekStart)
      : day.with({ day: 1 });
  const length = rule.freq === "WEEKLY" ? 7 : first.daysInMonth;
  const set: Temporal.PlainDate[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const candidate = first.add({ days: offset });
    if (passesDayParts(rule, start, candidate)) {
      set.push(candidate);
    }
  }
  const index = set.findIndex(
    (candidate) => Temporal.PlainDate.compare(candidate, day) === 0
  );
  return rule.bySetPos.some((position) =>
    position > 0 ? index === position - 1 : index === set.length + position
  );
}

function matches(
  rule: Rule,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  if (Temporal.PlainDate.compare(day, start) < 0) {
    return false;
  }
  if (!(inRulePeriod(rule, start, day) && passesDayParts(rule, start, day))) {
    return false;
  }
  return rule.bySetPos.length === 0 || atSetPosition(rule, start, day);
}

/**
 * Whether `day` is one of `rule`'s days from the series' `start` day; null
 * when the rule has parts not read here. Ignores its time and its end.
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
 * A COUNT rule's first `count` days, walked from the series' `start` day,
 * or only those up to `through` when given; null when they can't be told. COUNT counts these, EXDATE skips included
 * and RDATE days not. Google counts the series' start as its first, rule
 * day or not.
 */
export function countedRuleDays(
  rule: string,
  start: Temporal.PlainDate,
  count: number,
  through?: Temporal.PlainDate
): Temporal.PlainDate[] | null {
  const read = readRule(rule);
  if (!read) {
    return null;
  }
  const days: Temporal.PlainDate[] = [];
  for (let offset = 0; offset < MAX_DAYS && days.length < count; offset += 1) {
    const day = start.add({ days: offset });
    if (through && Temporal.PlainDate.compare(day, through) > 0) {
      return days;
    }
    if (offset === 0 || matches(read, start, day)) {
      days.push(day);
    }
  }
  return days.length === count ? days : null;
}
