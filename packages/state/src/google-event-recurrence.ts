import { countedRuleDays, isRuleDay } from "@kompose/google-cal/rule-days";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  countedRuleMeetings,
  dayOfStart,
  matchRecurrenceToStart,
  moveSkippedDays,
  ruleTimesOf,
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
const UNTIL_PART = /([:;])UNTIL=[^;]+/;

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
    // Several days keep their set when the new start is already one of
    // them (a weekday standup moved to Tuesday still meets Mondays); the
    // start's day swaps for the new one only when that's a new day.
    const follows = byDay.includes(fromCode) && !byDay.includes(toCode);
    return {
      byDay: follows
        ? byDay.map((day) => (day === fromCode ? toCode : day))
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
  /** The start's time before the move, in `timeZone`; null all day. */
  fromTime?: Temporal.PlainTime | null;
  /** The new start's time in `timeZone`; null for an all-day one. */
  toTime?: Temporal.PlainTime | null;
}): string[] {
  const { allDay, from, fromTime, recurrence, timeZone, to, toTime } = params;
  const rule = getPrimaryRecurrenceRule(recurrence);
  if (!rule || Temporal.PlainDate.compare(from, to) === 0) {
    return recurrence;
  }
  const pattern = parseGoogleEventRecurrenceRule(rule);
  const untilDay =
    pattern.end.type === "until"
      ? untilRuleToDay(pattern.end.date, timeZone)
      : null;
  const movedEnd =
    untilDay && Temporal.PlainDate.compare(untilDay, to) < 0
      ? {
          date: untilRuleForDay(defaultUntilDay(to), allDay, timeZone),
          type: "until" as const,
        }
      : null;
  const end = movedEnd ?? pattern.end;
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
  // A rule the editor can't write (hourly, say) keeps its pattern; only an
  // end the start passed moves on.
  const kept =
    next ??
    (movedEnd ? rule.replace(UNTIL_PART, `$1UNTIL=${movedEnd.date}`) : rule);
  // Skipped days move with the pattern (also one that follows its start
  // without naming it, like a plain weekly rule), so none comes back; the
  // picked start is never left skipped.
  return moveSkippedDays({
    from,
    newRule: kept,
    oldRule: rule,
    recurrence:
      kept === rule ? recurrence : setPrimaryRecurrenceRule(recurrence, kept),
    fromTime,
    seriesZone: timeZone,
    to,
    toTime,
  });
}

/** The wall time a timed Google start is at in `timeZone`. */
function timeOfStart(
  start: { dateTime?: string | null },
  timeZone: string
): Temporal.PlainTime | null {
  try {
    return start.dateTime
      ? Temporal.Instant.from(start.dateTime)
          .toZonedDateTimeISO(timeZone)
          .toPlainTime()
      : null;
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

/**
 * The day a start shown in `fromZone` falls on in the series' zone: a
 * Tuesday 9:00 Tokyo meeting shown Monday evening in New York is on
 * Tuesday, which is the day its repeat counts. An all-day start (no time)
 * is the same day everywhere.
 */
export function dayInZone(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime | null,
  fromZone: string,
  toZone: string
): Temporal.PlainDate {
  if (!time || fromZone === toZone) {
    return date;
  }
  return date
    .toZonedDateTime({ plainTime: time, timeZone: fromZone })
    .withTimeZone(toZone)
    .toPlainDate();
}

/** The wall time a start shown in `fromZone` is at in the series' zone. */
export function timeInZone(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime | null,
  fromZone: string,
  toZone: string
): Temporal.PlainTime | null {
  if (!time || fromZone === toZone) {
    return time;
  }
  return date
    .toZonedDateTime({ plainTime: time, timeZone: fromZone })
    .withTimeZone(toZone)
    .toPlainTime();
}

/** "Tokyo" for "Asia/Tokyo"; null for a zone that isn't a place ("UTC"). */
export function timeZoneCity(timeZone: string): string | null {
  const [area, ...rest] = timeZone.split("/");
  const city = rest.at(-1);
  return area === "Etc" || !city ? null : city.replace(/_/g, " ");
}

/** The event's own zone when it isn't `appZone`, for saying so. */
export function otherTimeZone(
  event: Pick<GoogleEvent, "start"> | undefined,
  appZone: string
): string | undefined {
  const zone = event?.start?.timeZone;
  return zone && zone !== appZone ? zone : undefined;
}

/** Whether two Google starts are the same moment (or the same date). */
function sameStart(
  a: { date?: string | null; dateTime?: string | null },
  b: { date?: string | null; dateTime?: string | null } | undefined
): boolean {
  if (!b) {
    return false;
  }
  if (a.date || b.date) {
    return a.date === b.date;
  }
  try {
    return Boolean(
      a.dateTime &&
        b.dateTime &&
        Temporal.Instant.compare(
          Temporal.Instant.from(a.dateTime),
          Temporal.Instant.from(b.dateTime)
        ) === 0
    );
  } catch {
    return false;
  }
}

/**
 * The day a repeat counts its implicit days from ("weekly" on which
 * weekday, "monthly" on which date), in the series' zone. An occurrence's
 * unchanged repeat is the series', so it counts from the series' first day
 * (its DTSTART, which anchors the rule's implicit days; an added RDATE
 * meeting needn't share them), or, before the series loads, the
 * occurrence's place in the series (where the rule puts it): moving
 * this one occurrence doesn't change how the series is described
 * ("weekly" stays on the series' Sunday, not the Tuesday it's moved to).
 * A repeat the user changed, or any other event's, counts from the form's
 * start, where the save puts the series (a changed repeat on a moved
 * occurrence can only start a new series there).
 */
export function repeatCountingDay(params: {
  /**
   * The repeat now differs from the series' (what a save would send), not
   * merely touched: a change set back reads as the series' again.
   */
  changed: boolean;
  event:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId">
    | null
    | undefined;
  /** The form's start day, in the series' zone. */
  formDay: Temporal.PlainDate | null;
  /** The series' own start (its master's), once loaded. */
  seriesStart?: { date?: string | null; dateTime?: string | null } | null;
  timeZone: string;
}): Temporal.PlainDate | null {
  const { changed, event, timeZone } = params;
  if (changed || !event?.recurringEventId) {
    return params.formDay;
  }
  const first = params.seriesStart
    ? dayOfStart(params.seriesStart, timeZone)
    : null;
  const placed = event.originalStartTime
    ? dayOfStart(event.originalStartTime, timeZone)
    : null;
  return first ?? placed ?? params.formDay;
}

interface RepeatSkipParams {
  editedStart: { date?: string | null; dateTime?: string | null };
  occurrence: Pick<
    GoogleEvent,
    "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The repeat the save sends. */
  recurrence: string[] | undefined;
  /** The series' own start (its master's), once loaded. */
  seriesStart?: { date?: string | null; dateTime?: string | null } | null;
  timeZone: string;
}

/**
 * Why a new repeat, saved for the entire series, would skip this
 * occurrence (null when it wouldn't, or before the series loads: the
 * scope rules wait for it): an Entire series save keeps the series' first
 * meeting (its DTSTART) and counts the rule from there, so a day
 * left implicit (weekly with no days picked, monthly on "Day N", yearly)
 * comes from that first meeting, an interval counts its weeks or months
 * from it, and a COUNT or UNTIL can end the series before today. When the
 * rule counted that way doesn't meet on the occurrence's day, the editor's
 * words (which count from it) aren't what Entire series would save, and it
 * would drop the very meeting being edited: so the change applies from
 * here on.
 */
export function repeatSkipsOccurrence(
  params: RepeatSkipParams
): "day" | "end" | null {
  const { occurrence, seriesStart } = params;
  const rule = getPrimaryRecurrenceRule(params.recurrence);
  if (!(occurrence.recurringEventId && seriesStart && rule)) {
    return null;
  }
  const timeZone = eventTimeZone(occurrence, params.timeZone);
  const first = dayOfStart(seriesStart, timeZone);
  const day = dayOfStart(params.editedStart, timeZone);
  if (!(first && day) || Temporal.PlainDate.compare(day, first) <= 0) {
    return null;
  }
  // "day": its day isn't one, counted from the series' first meeting (an
  // implicit day, an interval's phase; unknown parts: as shown, as before).
  if (isRuleDay(rule, first, day) === false) {
    return "day";
  }
  // "end": its COUNT or UNTIL ends first. Entire series keeps the series'
  // own start time unless the edit retimes this occurrence (the server's
  // seriesTimesForEdit), and a timed COUNT counts from that time. A kept
  // start can still be a retime, by a new end, which isn't known here, so
  // both times count.
  const editedTime = timeOfStart(params.editedStart, timeZone);
  const savedTimes = sameStart(params.editedStart, occurrence.start)
    ? [timeOfStart(seriesStart, timeZone), editedTime]
    : [editedTime];
  const ends = savedTimes.some((seriesTime) =>
    seriesEndsBefore({
      edited: params.editedStart,
      first,
      rule,
      seriesTime,
      timeZone,
    })
  );
  return ends ? "end" : null;
}

/**
 * Whether a rule counted from the series' first meeting (`first`, at
 * `seriesTime`) ends (COUNT or UNTIL) before the `edited` start. A timed
 * series' COUNT counts each meeting (each of a rule's times a day, a time
 * the clocks skip not counted), as the server does; an all-day one's
 * counts days.
 */
function seriesEndsBefore(params: {
  edited: { date?: string | null; dateTime?: string | null };
  first: Temporal.PlainDate;
  rule: string;
  /** The series' start time once saved; null all day. */
  seriesTime: Temporal.PlainTime | null;
  timeZone: string;
}): boolean {
  const { edited, first, rule, seriesTime, timeZone } = params;
  const day = dayOfStart(edited, timeZone);
  const { end } = parseGoogleEventRecurrenceRule(rule);
  if (!day || end.type === "none") {
    return false;
  }
  if (end.type === "until") {
    const last = untilRuleToDay(end.date, timeZone);
    return Boolean(last && Temporal.PlainDate.compare(last, day) < 0);
  }
  const at = edited.dateTime ? Temporal.Instant.from(edited.dateTime) : null;
  const times = seriesTime ? ruleTimesOf(rule, seriesTime) : null;
  if (at && times) {
    const meetings = countedRuleMeetings({
      base: seriesTime,
      count: end.count,
      from: first,
      rule,
      times,
      timeZone,
    });
    // Null, or short of `count`, when its meetings can't all be listed.
    return Boolean(
      meetings?.size === end.count &&
        Math.max(...meetings) < at.epochMilliseconds
    );
  }
  // Null unless it found all `count` days.
  const last = countedRuleDays(rule, first, end.count)?.at(-1);
  return Boolean(last && Temporal.PlainDate.compare(last, day) < 0);
}

/**
 * The day an "Ends on" date defaults from and can't be before: the
 * occurrence's own day (not the series' first, which can be years back),
 * or today when that's later, in the series' zone.
 */
export function untilDefaultDay(
  from: Temporal.PlainDate,
  timeZone: string
): Temporal.PlainDate {
  const today = Temporal.Now.plainDateISO(timeZone);
  return defaultUntilDay(
    Temporal.PlainDate.compare(from, today) > 0 ? from : today
  );
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
  /** The series' own start, its first day (where COUNT counts from). */
  masterStart?: { date?: string | null; dateTime?: string | null } | null;
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
  // An edit that leaves the occurrence's start as it was changes nothing
  // about the series' days, times or form: renaming one rescheduled before
  // mustn't retarget the series to its slot.
  if (sameStart(editedStart, occurrence.start)) {
    return;
  }
  const allDay = Boolean(editedStart.date);
  // The rule follows only a day this edit moves, from the occurrence's
  // place in the series (where the rule puts it, even if it was
  // rescheduled before). Without a move, nothing is sent: the server lines
  // the series' own rule, freshly read, up with the new time or form (All
  // day), so a copy cached here can't write an old rule back.
  const moved = occurrenceDayMoved({ editedStart, occurrence, timeZone });
  if (!moved) {
    return;
  }
  const from = dayOfStart(
    occurrence.originalStartTime ?? occurrence.start,
    timeZone
  );
  const to = dayOfStart(editedStart, timeZone);
  if (!(from && to)) {
    return;
  }
  const followed = followStart({
    allDay,
    from,
    recurrence: masterRecurrence,
    timeZone,
    fromTime: timeOfStart(
      occurrence.originalStartTime ?? occurrence.start,
      timeZone
    ),
    to,
    toTime: timeOfStart(editedStart, timeZone),
  });
  const matched = matchRecurrenceToStart(
    followed,
    editedStart,
    timeZone,
    occurrence.originalStartTime ?? occurrence.start,
    // The rules followed the start, so they and their COUNT count from the
    // new day (a later occurrence's day can only run long, which keeps
    // skips), from the series' own start time.
    {
      firstDay: to,
      firstTime: params.masterStart
        ? timeOfStart(params.masterStart, timeZone)
        : null,
      rulesFrom: to,
      viaOccurrence: true,
    }
  );
  return matched === masterRecurrence ? undefined : matched;
}

/**
 * Where a series edited through one of its occurrences counts its days
 * and COUNT from: the series' own first day, for lining its rule up with
 * the start (`matchRecurrenceToStart`'s `days`). Undefined for the series
 * itself, or before its master loads: the start is then its own.
 */
export function seriesCountingDays(
  event: Pick<GoogleEvent, "recurringEventId"> | null | undefined,
  masterStart:
    | { date?: string | null; dateTime?: string | null }
    | null
    | undefined,
  timeZone: string
):
  | {
      firstDay: Temporal.PlainDate | null;
      firstTime: Temporal.PlainTime | null;
      rulesFrom?: Temporal.PlainDate;
      viaOccurrence: true;
    }
  | undefined {
  const firstDay =
    event?.recurringEventId && masterStart
      ? dayOfStart(masterStart, timeZone)
      : null;
  return firstDay && masterStart
    ? {
        firstDay,
        firstTime: timeOfStart(masterStart, timeZone),
        rulesFrom: firstDay,
        viaOccurrence: true,
      }
    : undefined;
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
  return (
    params.edited &&
    JSON.stringify(params.recurrence ?? []) !== JSON.stringify(params.source)
  );
}

/**
 * The end day (UNTIL) of a repeat the save sends when it's before the
 * event's own start day, else null: possible once its end was picked and
 * the start then moved past it. Saved, the new series would end before it
 * starts.
 */
export function repeatEndsBeforeStart(params: {
  /** The save sends this repeat (a new event's, or a changed one). */
  sent: boolean;
  recurrence: string[] | undefined;
  /** The start's day, in the series' zone. */
  startDay: Temporal.PlainDate | null;
  timeZone: string;
}): Temporal.PlainDate | null {
  const rule = getPrimaryRecurrenceRule(params.recurrence);
  if (!(params.sent && rule && params.startDay)) {
    return null;
  }
  const { end } = parseGoogleEventRecurrenceRule(rule);
  const last =
    end.type === "until" ? untilRuleToDay(end.date, params.timeZone) : null;
  return last && Temporal.PlainDate.compare(last, params.startDay) < 0
    ? last
    : null;
}
