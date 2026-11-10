import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { RRuleTemporal } from "rrule-temporal";
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

const RULE_REFERENCE =
  Temporal.PlainDate.from("2000-01-01").toZonedDateTime("UTC");
const UNTIL_PART = /(?:^|;)UNTIL=([^;]+)/;
const SERIALIZED_UNTIL = /UNTIL=[^;]+/;

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

  try {
    const options = new RRuleTemporal({
      rruleString: rule,
      dtstart: RULE_REFERENCE,
      temporal: Temporal,
    }).options();
    let freq: EventRecurrenceFrequency = "custom";
    if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(options.freq)) {
      // These are the four frequencies the editors offer.
      freq = options.freq as EventRecurrenceFrequency;
    }
    const until = UNTIL_PART.exec(rule.slice(6))?.[1];
    let end: EventRecurrenceEnd = { type: "none" };
    if (until) {
      end = { type: "until", date: until };
    } else if (options.count) {
      end = { type: "count", count: options.count };
    }
    return {
      byDay: options.byDay ?? [],
      end,
      freq,
      interval: options.interval ?? 1,
      monthDays: (options.byMonthDay ?? []).map(String),
    };
  } catch {
    return {
      byDay: [],
      end: { type: "none" },
      freq: "custom",
      interval: 1,
      monthDays: [],
    };
  }
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

  const base = baseRule
    ? new RRuleTemporal({
        rruleString: baseRule,
        dtstart: RULE_REFERENCE,
        temporal: Temporal,
      })
    : undefined;
  const previous = base?.options();
  const frequencyChanged = previous?.freq !== freq;
  const daysChanged =
    byDay.join() !== (previous?.byDay ?? []).join() ||
    monthDays.join() !== (previous?.byMonthDay ?? []).join();
  const until =
    end.type === "until"
      ? new RRuleTemporal({
          rruleString: `RRULE:FREQ=DAILY;UNTIL=${end.date}`,
          dtstart: RULE_REFERENCE,
          temporal: Temporal,
        }).options().until
      : undefined;
  const rule = new RRuleTemporal({
    ...previous,
    dtstart: previous?.dtstart ?? RULE_REFERENCE,
    temporal: Temporal,
    freq,
    interval,
    byDay: weekOrdered(byDay),
    byMonthDay: monthDays.map(Number),
    byMonth: frequencyChanged ? undefined : previous?.byMonth,
    byYearDay: frequencyChanged ? undefined : previous?.byYearDay,
    byWeekNo: frequencyChanged ? undefined : previous?.byWeekNo,
    bySetPos: frequencyChanged || daysChanged ? undefined : previous?.bySetPos,
    count: end.type === "count" ? end.count : undefined,
    until,
  })
    .toString()
    .split("\n")
    .find((line) => line.startsWith("RRULE:"));
  // Google uses date-only UNTIL for all-day events; the library serializes UTC.
  return rule && end.type === "until"
    ? rule.replace(SERIALIZED_UNTIL, `UNTIL=${end.date}`)
    : (rule ?? null);
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

/**
 * "RRULE:BYDAY=MO,SU;FREQ=WEEKLY" for any order of its parts and of the
 * values in each, neither of which changes what the rule means.
 */
function sortedRuleParts(line: string): string {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return line;
  }
  const parts = line
    .slice(colon + 1)
    .split(";")
    .map((part) => {
      const [name, values = ""] = part.split("=");
      return `${name}=${values.split(",").sort().join(",")}`;
    })
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
