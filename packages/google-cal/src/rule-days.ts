/**
 * Whether a day is one of a recurrence rule's own occurrences (RFC 5545):
 * FREQ DAILY, WEEKLY, MONTHLY or YEARLY with INTERVAL, BYDAY (weekdays,
 * and weekdays of the month for monthly or yearly-by-month rules),
 * BYMONTHDAY, BYMONTH, BYSETPOS (monthly or weekly), WKST, and a single
 * BYHOUR / BYMINUTE / BYSECOND (one time a day). Each BY part narrows the
 * set ("Monday, the 1st to the 7th" is the first Monday). Anything else
 * (BYYEARDAY, BYWEEKNO, several times a day, sub-daily frequencies, a
 * yearly weekday without a month) isn't read: the answer is then null,
 * "can't tell".
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
/** Parts that set the time: read only with one value (one time a day). */
const CLOCK_PARTS = ["BYHOUR", "BYMINUTE", "BYSECOND"];
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
  if (CLOCK_PARTS.some((key) => list(key).length > 1)) {
    return null;
  }
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

/** Whether `day` matches a BYDAY entry within its month ("2TU", "-1FR", "TU"). */
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
 * Whether `day` passes the rule's day filters (every BY part given must
 * hold), before BYSETPOS and the period: the start's own day stands in for
 * a day part the rule doesn't give, as RFC 5545 has it.
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

/** Whether `day` is in a period (day, week, month, year) the rule repeats in. */
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

/** Whether `day` is at one of BYSETPOS's places among its month's (or week's) days. */
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
 * many are left. The series' first start is its first occurrence, rule
 * day or not (Google counts it so), for a rule at its time
 * (`countsStart`); another rule counts that day only as one of its own.
 */
export function countedRuleDays(
  rule: string,
  start: Temporal.PlainDate,
  count: number,
  countsStart = true
): Temporal.PlainDate[] | null {
  const read = readRule(rule);
  if (!read) {
    return null;
  }
  const days: Temporal.PlainDate[] = [];
  for (let offset = 0; offset < MAX_DAYS && days.length < count; offset += 1) {
    const day = start.add({ days: offset });
    if ((offset === 0 && countsStart) || matches(read, start, day)) {
      days.push(day);
    }
  }
  return days.length === count ? days : null;
}
