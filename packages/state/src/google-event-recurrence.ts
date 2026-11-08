import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";

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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function untilRuleToInput(raw?: string | null): string {
  if (!raw) {
    return "";
  }

  const cleaned = raw.replace(/[-:]/g, "");
  const dateOnlyMatch = cleaned.match(UNTIL_RULE_REGEX_DATEONLY);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return `${y}-${m}-${d}T00:00`;
  }

  const fullMatch = cleaned.match(UNTIL_RULE_REGEX_FULL);
  if (!fullMatch) {
    return "";
  }

  const [, y, m, d, hh, mm, ss, offset] = fullMatch;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset ?? "Z"}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function untilInputToRule(input?: string | null): string | null {
  if (!input) {
    return null;
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function untilRuleToDate(raw?: string | null): Date | null {
  const input = untilRuleToInput(raw);
  if (!input) {
    return null;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToUntilRule(date: Date): string | null {
  const input = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return untilInputToRule(input);
}

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
  byDay: string[];
  end: EventRecurrenceEnd;
  freq: EventRecurrenceFrequency;
  /** Every how many days, weeks, months or years (1: every one). */
  interval: number;
}

export function parseGoogleEventRecurrenceRule(
  rule?: string
): EventRecurrencePattern {
  if (!rule?.startsWith("RRULE:")) {
    return { byDay: [], end: { type: "none" }, freq: "none", interval: 1 };
  }

  const body = rule.replace("RRULE:", "");
  const parts = body.split(";");

  let freq: EventRecurrenceFrequency = "none";
  let byDay: string[] = [];
  let until: string | null = null;
  let count: number | null = null;
  let interval = 1;

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

  return { byDay, end: resolveEnd(until, count), freq, interval };
}

/** The rule parts the repeat editors set; the rest of a rule is kept. */
const EDITED_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT"]);
/** Parts tied to a frequency, dropped when the frequency changes. */
const FREQUENCY_PARTS = new Set([
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "BYYEARDAY",
  "BYWEEKNO",
]);

/**
 * The parts of `baseRule` an edit keeps: everything the editors don't set
 * (WKST, BYMONTH...); parts tied to the frequency go when it changes, and
 * a day of the month goes when a weekday of the month ("2nd Tue") is set.
 */
function keptRuleParts(
  baseRule: string | undefined,
  { byDay, freq }: EventRecurrencePattern
): string[] {
  if (!baseRule?.startsWith("RRULE:")) {
    return [];
  }
  const parts = baseRule.replace("RRULE:", "").split(";");
  const baseFreq = parts
    .find((part) => part.startsWith("FREQ="))
    ?.slice("FREQ=".length);
  return parts.filter((part) => {
    const key = part.split("=")[0] ?? "";
    if (!part || EDITED_PARTS.has(key)) {
      return false;
    }
    if (key === "BYMONTHDAY" && byDay.some((day) => ORDINAL_DAY.test(day))) {
      return false;
    }
    return baseFreq === freq || !FREQUENCY_PARTS.has(key);
  });
}

const PLAIN_WEEKDAY = /^[A-Z]{2}$/;

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
    byDay:
      to === "WEEKLY"
        ? pattern.byDay.filter((day) => PLAIN_WEEKDAY.test(day))
        : [],
    freq: to,
    interval: 1,
  };
}

/** The rule for `pattern`, keeping `baseRule`'s other parts. */
export function buildGoogleEventRecurrenceRule(
  pattern: EventRecurrencePattern,
  /** The rule being edited, whose other parts are kept. */
  baseRule?: string
): string | null {
  const { byDay, end, freq, interval } = pattern;
  if (freq === "none") {
    return null;
  }

  const parts: string[] = [`FREQ=${freq}`];
  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  parts.push(...keptRuleParts(baseRule, pattern));
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
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * The weekday of the month `date` falls on, as BYDAY: "2TU" for the 2nd
 * Tuesday; a 5th is "-1TU", the last (not every month has a 5th).
 * `dayOfWeek` runs 1 Monday to 7 Sunday.
 */
export function monthlyWeekdayOf(date: {
  day: number;
  dayOfWeek: number;
}): string {
  const nth = Math.ceil(date.day / 7);
  return `${nth >= 5 ? -1 : nth}${WEEKDAY_CODES[date.dayOfWeek - 1] ?? "MO"}`;
}

/**
 * UNTIL for a series that ends on `date`'s local day, that day's
 * occurrence included: the date itself for an all-day series, otherwise
 * the day's last second in UTC (midnight would drop a 10 AM meeting).
 */
export function untilRuleForDay(date: Date, allDay: boolean): string {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  if (allDay) {
    return ymd;
  }
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59
  );
  return `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}${pad(end.getUTCSeconds())}Z`;
}

/** The end date "On date" starts at: three months after the series starts. */
export function defaultUntilDay(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth() + 3, start.getDate());
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

const DAY_NAMES: Record<string, string> = {
  FR: "Fri",
  MO: "Mon",
  SA: "Sat",
  SU: "Sun",
  TH: "Thu",
  TU: "Tue",
  WE: "Wed",
};

const BY_MONTH_PATTERN = /BYMONTH=(\d{1,2})(?:;|$)/;
const BY_MONTH_DAY_PATTERN = /BYMONTHDAY=(-?\d{1,2})(?:;|$)/;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const ORDINAL_DAY = /^(-?\d)([A-Z]{2})$/;
const ORDINAL_WORDS: Record<string, string> = {
  "-1": "last",
  "-2": "second-to-last",
  "1": "1st",
  "2": "2nd",
  "3": "3rd",
  "4": "4th",
  "5": "5th",
};

/**
 * Which day of the month or year a monthly or yearly rule falls on, in
 * words: "on the 2nd Tue", "on day 15", "on the 4th Thu of Nov". Null when
 * the rule doesn't say (it then repeats on the start's day) or says it in
 * a way not put in words here.
 */
function dayOfPeriod(
  rule: string | undefined,
  freq: EventRecurrenceFrequency,
  byDay: string[]
): string | null {
  const weekdays = byDay.map(ordinalDayLabel);
  const ordinal =
    weekdays.length > 0 && weekdays.every(Boolean)
      ? `on the ${weekdays.join(", ")}`
      : null;
  const monthDay = BY_MONTH_DAY_PATTERN.exec(rule ?? "")?.[1];
  if (freq === "MONTHLY") {
    if (ordinal || !monthDay) {
      return ordinal;
    }
    return monthDay === "-1" ? "on the last day" : `on day ${monthDay}`;
  }
  // Yearly "4th Thu" with no month is the 4th Thursday of the year.
  const month = MONTH_NAMES[Number(BY_MONTH_PATTERN.exec(rule ?? "")?.[1]) - 1];
  if (freq !== "YEARLY" || !month) {
    return null;
  }
  if (ordinal) {
    return `${ordinal} of ${month}`;
  }
  return monthDay && !monthDay.startsWith("-")
    ? `on ${month} ${monthDay}`
    : null;
}

/** "2nd Tue" for BYDAY=2TU; null for a plain or unknown code. */
export function ordinalDayLabel(code: string): string | null {
  const match = ORDINAL_DAY.exec(code);
  const ordinal = match ? ORDINAL_WORDS[match[1] ?? ""] : undefined;
  const day = match ? DAY_NAMES[match[2] ?? ""] : undefined;
  return ordinal && day ? `${ordinal} ${day}` : null;
}

const FREQUENCY_WORDS: Record<string, [string, string] | undefined> = {
  DAILY: ["daily", "days"],
  MONTHLY: ["monthly", "months"],
  WEEKLY: ["weekly", "weeks"],
  YEARLY: ["yearly", "years"],
};

/**
 * How a Google event repeats, for a read-only view ("Repeats weekly on Mon,
 * Wed"). `rules` is the series' RRULE list (the event's own, or its
 * master's). An instance whose rule isn't loaded still says it repeats.
 * Null for a one-off event.
 */
export function describeEventRecurrence(params: {
  eventType?: string | null;
  recurringEventId?: string | null;
  rules: string[] | null | undefined;
  /**
   * The start's weekday (1 Monday to 7 Sunday): a weekly rule with no days
   * repeats on it, and says so ("Repeats weekly on Sat").
   */
  startWeekday?: number;
}): string | null {
  const rule = getPrimaryRecurrenceRule(params.rules ?? []) ?? undefined;
  const { byDay, freq, interval } = parseGoogleEventRecurrenceRule(rule);
  const words = FREQUENCY_WORDS[freq];
  if (!words) {
    if (params.eventType === "birthday") {
      return "Repeats yearly";
    }
    // A rule this app can't put in words (hourly, say) still repeats.
    return params.recurringEventId || rule ? "Repeats" : null;
  }
  const base =
    interval > 1
      ? `Repeats every ${interval} ${words[1]}`
      : `Repeats ${words[0]}`;
  const startDay = params.startWeekday
    ? WEEKDAY_CODES[params.startWeekday - 1]
    : undefined;
  const shownDays = byDay.length > 0 || !startDay ? byDay : [startDay];
  const days = shownDays
    .map((code) => DAY_NAMES[code.slice(-2)])
    .filter(Boolean)
    .join(", ");
  if (freq === "WEEKLY") {
    return days ? `${base} on ${days}` : base;
  }
  const when = dayOfPeriod(rule, freq, byDay);
  return when ? `${base} ${when}` : base;
}
