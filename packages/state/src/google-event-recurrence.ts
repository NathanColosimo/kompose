import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { Temporal } from "temporal-polyfill";

export type EventRecurrenceFrequency =
  | "none"
  | "custom"
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

  let freq: EventRecurrenceFrequency = "custom";
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

/** A plain BYDAY weekday ("TU"), not a weekday of the month ("2TU"). */
export function isPlainWeekday(code: string): boolean {
  return PLAIN_WEEKDAY.test(code);
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

  if (freq === "custom") {
    return baseRule ?? null;
  }

  const parts: string[] = [`FREQ=${freq}`];
  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  parts.push(...keptRuleParts(baseRule, pattern));
  // Both can stand together ("the 2nd Tue, if it's the 8th to the 10th");
  // a day choice in the editors sets the one it means and clears the other.
  if (monthDays.length > 0) {
    parts.push(`BYMONTHDAY=${monthDays.join(",")}`);
  }
  if (byDay.length > 0) {
    parts.push(`BYDAY=${weekOrdered(byDay).join(",")}`);
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

/**
 * BYDAY days in week order, Monday first as the app's weeks are, however
 * they were picked ("TH,MO" is "MO,TH"); a weekday of the month by its
 * weekday ("1FR" after "3MO").
 */
export function weekOrdered(days: string[]): string[] {
  const rank = (code: string) => WEEKDAY_CODES.indexOf(code.slice(-2));
  return [...days].sort((a, b) => rank(a) - rank(b));
}

/** The BYDAY weekday `date` falls on: "TU". */
export function weekdayCodeOf(date: { dayOfWeek: number }): string {
  return WEEKDAY_CODES[date.dayOfWeek - 1] ?? "MO";
}

/** "-1FR" when `date` is the last Friday of its month; otherwise null. */
export function lastWeekdayOf(date: Temporal.PlainDate): string | null {
  return date.day + 7 > date.daysInMonth ? `-1${weekdayCodeOf(date)}` : null;
}

const BY_SET_POS = /(?:^|;)BYSETPOS=(-?\d)(?:;|$)/;
const HAS_SET_POS = /(?:^|;)BYSETPOS=/;

/**
 * The BYSETPOS a rule picks with, when it's one position ("-1"); null when
 * it has several ("1,3"), which the editor labels custom;
 * undefined when it has none.
 */
export function setPositionOf(
  rule: string | undefined
): string | null | undefined {
  if (!HAS_SET_POS.test(rule ?? "")) {
    return;
  }
  return BY_SET_POS.exec(rule ?? "")?.[1] ?? null;
}

export function eventTimeZone(
  event: Pick<GoogleEvent, "start"> | undefined,
  fallback: string
): string {
  return event?.start?.timeZone ?? fallback;
}

export function untilDefaultDay(
  from: Temporal.PlainDate,
  timeZone: string
): Temporal.PlainDate {
  const today = Temporal.Now.plainDateISO(timeZone);
  return (Temporal.PlainDate.compare(from, today) > 0 ? from : today).add({
    months: 3,
  });
}

const isRule = (line: string) => line.startsWith("RRULE:");

/** The series' RRULE line; Google may list EXDATE/RDATE lines with it. */
export function getPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined
): string | undefined {
  return recurrence?.find(isRule);
}

/**
 * Replace the series' primary RRULE (the one the editors show), keeping
 * every other line: deleted occurrences stay deleted, and a series with
 * more than one RRULE (Mondays and Fridays as two rules) keeps the others.
 * Without a rule nothing repeats, so the whole list clears: EXDATE lines
 * alone aren't a series.
 */
export function setPrimaryRecurrenceRule(
  recurrence: string[] | null | undefined,
  rule: string | null
): string[] {
  if (!rule) {
    return [];
  }
  const lines = recurrence ?? [];
  const primary = lines.findIndex(isRule);
  return [rule, ...lines.filter((_, index) => index !== primary)];
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

/**
 * What an occurrence's repeat row shows. While the series' rule can't be
 * used (loading, refreshing, or its refresh failed), the row still shows
 * the series' last known rule, a cached copy the form hasn't taken, for
 * display only (the form and a save keep their own). A repeat the user
 * changed shows as they set it, "doesn't repeat" included.
 */
export function occurrenceRepeatShown(params: {
  /** The user changed the repeat in this editor. */
  edited: boolean;
  /** The form's recurrence. */
  recurrence: string[];
  /** The series' cached recurrence, if any. */
  seriesRecurrence: string[] | undefined;
  /** The series' rule can't be used yet. */
  unusable: boolean;
}): {
  /** It repeats, but how isn't known yet: no rule to show. */
  loading: boolean;
  rules: string[];
} {
  if (!params.unusable || params.edited) {
    return { loading: false, rules: params.recurrence };
  }
  const rules =
    params.recurrence.length > 0
      ? params.recurrence
      : (params.seriesRecurrence ?? []);
  return { loading: true, rules };
}

/**
 * Whether an editor's repeat now differs from the series' (what a save
 * sends): the user touched it and it isn't the series' own list, so a
 * change set back reads as unchanged.
 */
export function repeatChanged(params: {
  /** The user touched the repeat in this editor. */
  edited: boolean;
  recurrence: string[] | undefined;
  /** The series' recurrence (the event's own, or its master's). */
  source: string[];
}): boolean {
  const normalized = (lines: string[]) =>
    JSON.stringify(lines.map(sortedRuleParts));
  return (
    params.edited &&
    normalized(params.recurrence ?? []) !== normalized(params.source)
  );
}

/** "RRULE:COUNT=5;FREQ=WEEKLY" for either order of its parts. */
function sortedRuleParts(line: string): string {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return line;
  }
  const parts = line
    .slice(colon + 1)
    .split(";")
    .sort();
  return `${line.slice(0, colon + 1)}${parts.join(";")}`;
}

const RECURRENCE_DATE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/;

/** Read an UNTIL date for the repeat editor and label. */
export function recurrenceEndDay(
  value: string,
  timeZone: string
): Temporal.PlainDate | null {
  const match = RECURRENCE_DATE.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month}-${day}`;
  try {
    return hour === undefined
      ? Temporal.PlainDate.from(date)
      : Temporal.Instant.from(`${date}T${hour}:${minute}:${second}Z`)
          .toZonedDateTimeISO(timeZone)
          .toPlainDate();
  } catch {
    return null;
  }
}
