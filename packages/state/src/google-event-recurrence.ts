import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  matchUntilToStart,
  untilRuleForDay,
  untilRuleToDay,
} from "@kompose/google-cal/until";
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
  // Both can stand together ("the 2nd Tue, if it's the 8th to the 10th");
  // a day choice in the editors sets the one it means and clears the other.
  if (monthDays.length > 0) {
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

const BY_SET_POS = /(?:^|;)BYSETPOS=(-?\d)(?:;|$)/;
const HAS_SET_POS = /(?:^|;)BYSETPOS=/;
const BY_MONTH = /(?:^|;)BYMONTH=(\d{1,2})(?:;|$)/;

/**
 * The BYSETPOS a rule picks with, when it's one position ("-1"); null when
 * it has several ("1,3"), which nothing here puts in words or follows;
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

/**
 * The days a series repeats on once its start moves from `from` to `to`:
 * a weekly series' start weekday swaps for the new one (Tuesdays become
 * Wednesdays); a monthly or yearly weekday of the month that was the
 * start's follows it ("2nd Tue" to "3rd Wed", "BYDAY=SA;BYSETPOS=1" too;
 * a last stays a last), as does a day of the month that was the start's.
 */
function followedDays(
  rule: string,
  pattern: EventRecurrencePattern,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate
): Pick<EventRecurrencePattern, "byDay" | "monthDays"> {
  const { byDay, freq, monthDays } = pattern;
  if (freq === "WEEKLY") {
    const fromCode = weekdayCodeOf(from);
    const toCode = weekdayCodeOf(to);
    return {
      byDay: byDay.includes(fromCode)
        ? [...new Set(byDay.map((day) => (day === fromCode ? toCode : day)))]
        : byDay,
      monthDays,
    };
  }
  if (freq !== "MONTHLY" && freq !== "YEARLY") {
    return { byDay, monthDays };
  }
  // "BYDAY=SA;BYSETPOS=1" is the 1st Sat, written another way.
  const setPos = setPositionOf(rule);
  const [onlyDay = ""] = byDay;
  const weekday =
    byDay.length === 1 && setPos && isPlainWeekday(onlyDay)
      ? `${setPos}${onlyDay}`
      : onlyDay;
  const followed =
    byDay.length === 1 && isWeekdayOfMonth(weekday)
      ? followedWeekday(weekday, from, to)
      : null;
  return {
    byDay: followed && followed !== weekday ? [followed] : byDay,
    monthDays:
      monthDays.join() === String(from.day) ? [String(to.day)] : monthDays,
  };
}

/**
 * `recurrence` after the series' start moves from `from` to `to`: the
 * days that were the start's follow it (see followedDays), a yearly
 * series' month does too when it was the start's, and an end date the
 * start moved past moves three months after the new start. The same
 * array when nothing follows.
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
  const built = buildGoogleEventRecurrenceRule(
    { ...pattern, ...followedDays(rule, pattern, from, to), end },
    rule
  );
  const next =
    pattern.freq === "YEARLY" && BY_MONTH.exec(rule)?.[1] === String(from.month)
      ? built?.replace(BY_MONTH, (match) =>
          match.replace(`=${from.month}`, `=${to.month}`)
        )
      : built;
  return next === rule
    ? recurrence
    : setPrimaryRecurrenceRule(recurrence, next ?? null);
}

/** The local day a Google start falls on in `timeZone`. */
function dayOfStart(
  start: { date?: string | null; dateTime?: string | null },
  timeZone: string
): Temporal.PlainDate | null {
  if (start.date) {
    return Temporal.PlainDate.from(start.date);
  }
  if (!start.dateTime) {
    return null;
  }
  try {
    return Temporal.Instant.from(start.dateTime)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

/**
 * The zone an event's own times are in: a recurring one's days are
 * counted, and its edits written, there (a Tokyo 9:00 meeting is on
 * Tokyo's Tuesday wherever it's viewed from, and Google repeats it in that
 * zone). `fallback` when the event doesn't say.
 */
export function eventTimeZone(
  event: Pick<GoogleEvent, "start"> | undefined,
  fallback: string
): string {
  return event?.start?.timeZone ?? fallback;
}

/** The event's own zone when it isn't `appZone`, for saying so. */
export function otherTimeZone(
  event: Pick<GoogleEvent, "start"> | undefined,
  appZone: string
): string | undefined {
  const zone = event?.start?.timeZone;
  return zone && zone !== appZone ? zone : undefined;
}

/** Whether a save moves an occurrence to another day (not just its time). */
export function occurrenceDayMoved(params: {
  editedStart: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  };
  occurrence: Pick<
    GoogleEvent,
    "originalStartTime" | "recurringEventId" | "start"
  >;
  timeZone: string;
}): boolean {
  const { editedStart, occurrence } = params;
  if (!occurrence.recurringEventId) {
    return false;
  }
  const timeZone = eventTimeZone(occurrence, params.timeZone);
  // Against where it is now: one rescheduled before, then only renamed,
  // hasn't moved in this edit.
  const from = dayOfStart(occurrence.start, timeZone);
  const to = dayOfStart(editedStart, timeZone);
  return Boolean(from && to && Temporal.PlainDate.compare(from, to) !== 0);
}

/**
 * The series' rule to send when a save applies to an occurrence's series
 * ("following" or "all"; one occurrence never sends a rule) without the
 * user changing it: it follows a moved date (followStart), so "Book club,
 * 1st Sat" moved to the 2nd Sat repeats on 2nd Sats, and its UNTIL takes
 * the form an all-day or timed start needs. Undefined (the series keeps
 * its rule) when the save sends its own rule or nothing changes.
 */
export function seriesRecurrenceForSave(params: {
  /** The edited start. */
  editedStart: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  };
  masterRecurrence: string[] | null | undefined;
  occurrence: Pick<
    GoogleEvent,
    "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The rule the save already sends, if any. */
  recurrence: string[] | undefined;
  timeZone: string;
}): string[] | undefined {
  const { editedStart, masterRecurrence, occurrence } = params;
  const timeZone = eventTimeZone(occurrence, params.timeZone);
  if (
    params.recurrence !== undefined ||
    !occurrence.recurringEventId ||
    !masterRecurrence?.length
  ) {
    return;
  }
  const allDay = Boolean(editedStart.date);
  // The rule follows only a day this edit moves, from the occurrence's
  // place in the series (where the rule puts it, even if it was
  // rescheduled before).
  const moved = occurrenceDayMoved({ editedStart, occurrence, timeZone });
  const from = dayOfStart(
    occurrence.originalStartTime ?? occurrence.start,
    timeZone
  );
  const to = dayOfStart(editedStart, timeZone);
  const followed =
    moved && from && to
      ? followStart({
          allDay,
          from,
          recurrence: masterRecurrence,
          timeZone,
          to,
        })
      : masterRecurrence;
  const matched = matchUntilToStart(followed, allDay, timeZone);
  return matched === masterRecurrence ? undefined : matched;
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
