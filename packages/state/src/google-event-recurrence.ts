import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";

export type EventRecurrenceFrequency =
  | "none"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY";

export type EventRecurrenceEnd =
  | { type: "none" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export const GOOGLE_EVENT_WEEKDAYS: Array<{ value: string; label: string }> = [
  { label: "Mon", value: "MO" },
  { label: "Tue", value: "TU" },
  { label: "Wed", value: "WE" },
  { label: "Thu", value: "TH" },
  { label: "Fri", value: "FR" },
  { label: "Sat", value: "SA" },
  { label: "Sun", value: "SU" },
];

const UNTIL_RULE_REGEX_DATEONLY = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_RULE_REGEX_FULL =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;

const VALID_FREQUENCIES = new Set<EventRecurrenceFrequency>([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
]);

function resolveEnd(
  until: string | null,
  count: number | null
): EventRecurrenceEnd {
  if (until !== null) {
    return { date: until, type: "until" };
  }
  if (count !== null) {
    return { count, type: "count" };
  }
  return { type: "none" };
}

/** What the repeat editors set on a rule; the rest of it is kept as is. */
export interface EventRecurrencePattern {
  /** BYDAY: weekdays ("MO"), or weekdays of the month ("2TU", "-1FR"). */
  byDay: string[];
  end: EventRecurrenceEnd;
  freq: EventRecurrenceFrequency;
  /** Every how many days, weeks, months or years (1: every one). */
  interval: number;
  /** BYMONTHDAY: days of the month ("15"; "-1" is the last). */
  monthDays: string[];
}

export function parseGoogleEventRecurrenceRule(
  rule?: string
): EventRecurrencePattern {
  if (!rule?.startsWith("RRULE:")) {
    return {
      byDay: [],
      end: { type: "none" },
      freq: "none",
      interval: 1,
      monthDays: [],
    };
  }

  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");

  let freq: EventRecurrenceFrequency = "none";
  let byDay: string[] = [];
  let until: string | null = null;
  let count: number | null = null;
  let interval = 1;
  let monthDays: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!value) {
      continue;
    }

    switch (key) {
      case "FREQ":
        if (VALID_FREQUENCIES.has(value as EventRecurrenceFrequency)) {
          freq = value as EventRecurrenceFrequency;
        }
        break;
      case "BYDAY":
        byDay = value.split(",");
        break;
      case "BYMONTHDAY":
        monthDays = value.split(",");
        break;
      case "UNTIL":
        until = value;
        break;
      case "COUNT": {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          count = parsed;
        }
        break;
      }
      case "INTERVAL": {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          interval = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return { byDay, end: resolveEnd(until, count), freq, interval, monthDays };
}

/** The rule parts the repeat editors set; the rest of a rule is kept. */
const EDITED_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "UNTIL",
  "COUNT",
]);
/** Parts tied to a frequency, dropped when the frequency changes. */
const FREQUENCY_PARTS = new Set([
  "BYMONTH",
  "BYSETPOS",
  "BYYEARDAY",
  "BYWEEKNO",
]);

/**
 * The parts of `baseRule` an edit keeps: everything the editors don't set
 * (WKST, BYMONTH...); parts tied to the frequency go when it changes, and
 * BYSETPOS, which picks among the days BYDAY / BYMONTHDAY name, goes when
 * those change (an end-only edit keeps it).
 */
function keptRuleParts(
  baseRule: string | undefined,
  { byDay, freq, monthDays }: EventRecurrencePattern
): string[] {
  if (!baseRule?.startsWith("RRULE:")) {
    return [];
  }
  const base = parseGoogleEventRecurrenceRule(baseRule);
  const sameDays =
    byDay.join() === base.byDay.join() &&
    monthDays.join() === base.monthDays.join();
  const parts = baseRule.replace("RRULE:", "").split(";");
  const baseFreq = parts
    .find((part) => part.startsWith("FREQ="))
    ?.slice("FREQ=".length);
  return parts.filter((part) => {
    const key = part.split("=")[0] ?? "";
    if (!part || EDITED_PARTS.has(key)) {
      return false;
    }
    if (key === "BYSETPOS" && !sameDays) {
      return false;
    }
    return baseFreq === freq || !FREQUENCY_PARTS.has(key);
  });
}

const PLAIN_WEEKDAY = /^[A-Z]{2}$/;
const WEEKDAY_OF_MONTH = /^-?\d[A-Z]{2}$/;

/** A plain BYDAY weekday ("TU"), not a weekday of the month ("2TU"). */
export function isPlainWeekday(code: string): boolean {
  return PLAIN_WEEKDAY.test(code);
}

/** A BYDAY weekday of the month: "2TU", "-1FR". */
export function isWeekdayOfMonth(code: string): boolean {
  return WEEKDAY_OF_MONTH.test(code);
}

/**
 * The pattern after picking frequency `to`. The same frequency changes
 * nothing (re-picking Monthly keeps "2nd Tuesday"). A new one starts at
 * every 1 (every 2 weeks, then Monthly, is every month) and keeps only the
 * days that mean something there: plain weekdays for Weekly ("2TU" isn't
 * valid weekly, and none left means the start's weekday), none otherwise.
 */
export function pickRecurrenceFrequency(
  pattern: EventRecurrencePattern,
  to: EventRecurrenceFrequency
): EventRecurrencePattern {
  if (pattern.freq === to) {
    return pattern;
  }
  return {
    ...pattern,
    byDay: to === "WEEKLY" ? pattern.byDay.filter(isPlainWeekday) : [],
    freq: to,
    interval: 1,
    monthDays: [],
  };
}

/** The rule for `pattern`, keeping `baseRule`'s other parts. */
export function buildGoogleEventRecurrenceRule(
  pattern: EventRecurrencePattern,
  /** The rule being edited, whose other parts are kept. */
  baseRule?: string
): string | null {
  const { byDay, end, freq, interval, monthDays } = pattern;
  if (freq === "none") {
    return null;
  }

  const parts: string[] = [`FREQ=${freq}`];
  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  parts.push(...keptRuleParts(baseRule, pattern));
  // A weekday of the month ("2nd Tue") replaces a day of the month.
  if (monthDays.length > 0 && !byDay.some(isWeekdayOfMonth)) {
    parts.push(`BYMONTHDAY=${monthDays.join(",")}`);
  }
  if (byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(",")}`);
  }

  if (end.type === "until") {
    parts.push(`UNTIL=${end.date}`);
  } else if (end.type === "count") {
    parts.push(`COUNT=${end.count}`);
  }

  return `RRULE:${parts.join(";")}`;
}

/** RRULE weekday codes by dayOfWeek (1 Monday to 7 Sunday). */
const WEEKDAY_CODES = GOOGLE_EVENT_WEEKDAYS.map((weekday) => weekday.value);

/** The BYDAY weekday `date` falls on: "TU". */
export function weekdayCodeOf(date: { dayOfWeek: number }): string {
  return WEEKDAY_CODES[date.dayOfWeek - 1] ?? "MO";
}

/**
 * The weekday of the month `date` falls on, as BYDAY: "2TU" for the 2nd
 * Tuesday; a 5th is "-1TU", the last (not every month has a 5th).
 */
export function monthlyWeekdayOf(date: Temporal.PlainDate): string {
  const nth = Math.ceil(date.day / 7);
  return `${nth >= 5 ? -1 : nth}${weekdayCodeOf(date)}`;
}

/** "-1FR" when `date` is the last Friday of its month; otherwise null. */
export function lastWeekdayOf(date: Temporal.PlainDate): string | null {
  return date.day + 7 > date.daysInMonth ? `-1${weekdayCodeOf(date)}` : null;
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
    return day.toString().replace(/-/g, "");
  }
  const instant = day
    .toZonedDateTime({ plainTime: "23:59:59", timeZone })
    .toInstant();
  return `${instant.toString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** The day an UNTIL falls on in `timeZone`. */
export function untilRuleToDay(
  rule: string,
  timeZone: string
): Temporal.PlainDate | null {
  const cleaned = rule.replace(/[-:]/g, "");
  const dateOnly = UNTIL_RULE_REGEX_DATEONLY.exec(cleaned);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return Temporal.PlainDate.from(`${y}-${m}-${d}`);
  }
  const full = UNTIL_RULE_REGEX_FULL.exec(cleaned);
  if (!full) {
    return null;
  }
  const [, y, m, d, hh, mm, ss, offset] = full;
  const zone =
    offset && offset !== "Z" ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "Z";
  try {
    return Temporal.Instant.from(`${y}-${m}-${d}T${hh}:${mm}:${ss}${zone}`)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

/** The end date "On date" starts at: three months after the series starts. */
export function defaultUntilDay(start: Temporal.PlainDate): Temporal.PlainDate {
  return start.add({ months: 3 });
}

/** The BYDAY a weekday-of-the-month pick has when the start moves. */
function followedWeekday(
  code: string,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate
): string {
  if (code === lastWeekdayOf(from) && code.startsWith("-1")) {
    return lastWeekdayOf(to) ?? monthlyWeekdayOf(to);
  }
  return code === monthlyWeekdayOf(from) ? monthlyWeekdayOf(to) : code;
}

/**
 * `recurrence` after the series' start moves from `from` to `to`: a day
 * or weekday of the month that was the start's follows it ("2nd Tue" to
 * "3rd Wed"; a last stays a last), and an end date the start moved past
 * moves three months after the new start. The same array when nothing
 * follows.
 */
export function followStart(params: {
  allDay: boolean;
  from: Temporal.PlainDate;
  recurrence: string[];
  timeZone: string;
  to: Temporal.PlainDate;
}): string[] {
  const { allDay, from, recurrence, timeZone, to } = params;
  const rule = getPrimaryRecurrenceRule(recurrence);
  if (!rule || Temporal.PlainDate.compare(from, to) === 0) {
    return recurrence;
  }
  const pattern = parseGoogleEventRecurrenceRule(rule);
  const monthly = pattern.freq === "MONTHLY" || pattern.freq === "YEARLY";
  const [onlyDay] = pattern.byDay;
  const byDay =
    monthly &&
    pattern.byDay.length === 1 &&
    onlyDay &&
    isWeekdayOfMonth(onlyDay)
      ? [followedWeekday(onlyDay, from, to)]
      : pattern.byDay;
  const monthDays =
    monthly && pattern.monthDays.join() === String(from.day)
      ? [String(to.day)]
      : pattern.monthDays;
  const untilDay =
    pattern.end.type === "until"
      ? untilRuleToDay(pattern.end.date, timeZone)
      : null;
  const end =
    untilDay && Temporal.PlainDate.compare(untilDay, to) < 0
      ? {
          date: untilRuleForDay(defaultUntilDay(to), allDay, timeZone),
          type: "until" as const,
        }
      : pattern.end;
  const next = buildGoogleEventRecurrenceRule(
    { ...pattern, byDay, end, monthDays },
    rule
  );
  return next === rule
    ? recurrence
    : setPrimaryRecurrenceRule(recurrence, next);
}

const isRule = (line: string) => line.startsWith("RRULE:");

/** The series' RRULE line; Google may list EXDATE/RDATE lines with it. */
export function getPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined
): string | undefined {
  return recurrence?.find(isRule);
}

/**
 * Replace the RRULE, keeping the series' other lines (deleted occurrences
 * stay deleted). Without a rule nothing repeats, so the whole list clears:
 * EXDATE lines alone aren't a series.
 */
export function setPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined,
  rule: string | null
): string[] {
  if (!rule) {
    return [];
  }
  return [rule, ...(recurrence ?? []).filter((line) => !isRule(line))];
}

export function isRecurringGoogleEvent(params: {
  event?: Pick<GoogleEvent, "recurringEventId" | "recurrence"> | null;
  masterRecurrence?: string[] | null;
}): boolean {
  return Boolean(
    params.event?.recurringEventId ||
      params.event?.recurrence?.length ||
      params.masterRecurrence?.length
  );
}

export function getDefaultRecurrenceScopeForEvent(params: {
  event?: Pick<GoogleEvent, "recurringEventId" | "recurrence"> | null;
  masterRecurrence?: string[] | null;
}): RecurrenceScope {
  if (params.event?.recurringEventId) {
    return "this";
  }
  if (params.event?.recurrence?.length || params.masterRecurrence?.length) {
    return "all";
  }
  return "this";
}
