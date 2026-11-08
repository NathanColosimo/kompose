import {
  addsSlot,
  carryCountExactly,
  countOf,
  seriesMeetsAt,
  splitAddedDays,
} from "@kompose/google-cal/recurrence-utils";
import { isRuleDay } from "@kompose/google-cal/rule-days";
import type {
  CreateEvent,
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  changedFields,
  keepsTimes,
  ownChanges,
  placeInNewSeries,
  sameLength,
  sameTime,
} from "@kompose/google-cal/series-edits";
import { seriesTimesForEdit } from "@kompose/google-cal/series-times";
import {
  dayOfStart,
  googleDateTime,
  matchRecurrenceToStart,
  meetsSeveralTimesADay,
  moveSkippedDays,
  ruleClock,
  startInstant,
  untilRuleForDay,
  untilRuleToDay,
} from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";
import type { EventTime, StartTime } from "./google-event-times";

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

/**
 * The wall time a timed Google start is at in `timeZone` (one without an
 * offset read in its own zone, as Google does).
 */
function timeOfStart(
  start: StartTime,
  timeZone: string
): Temporal.PlainTime | null {
  return (
    startInstant(start, timeZone)?.toZonedDateTimeISO(timeZone).toPlainTime() ??
    null
  );
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
 * The zone an occurrence's series counts its days in: its master's once
 * loaded, as the server reads it, else its original slot's. Not the
 * occurrence's own: a Tokyo series' meeting rescheduled in New York
 * still holds a Tokyo slot. `fallback` when none says.
 */
export function seriesTimeZone(
  occurrence: Pick<GoogleEvent, "originalStartTime" | "start">,
  seriesStart: StartTime | null | undefined,
  fallback: string
): string {
  return (
    seriesStart?.timeZone ??
    occurrence.originalStartTime?.timeZone ??
    eventTimeZone(occurrence, fallback)
  );
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

/**
 * The zone the event's days count in when it isn't `appZone`, for saying
 * so: its own, or an occurrence's series' (`seriesTimeZone`, from
 * `seriesStart` once the series loads).
 */
export function otherTimeZone(
  event: Pick<GoogleEvent, "originalStartTime" | "start"> | undefined,
  appZone: string,
  seriesStart?: StartTime | null
): string | undefined {
  const zone = event && seriesTimeZone(event, seriesStart, appZone);
  return zone && zone !== appZone ? zone : undefined;
}

/**
 * The day a series' own repeat counts its implicit days from ("weekly" on
 * which weekday, "monthly" on which date), in the series' zone, for an
 * occurrence whose save keeps the series' rule and the meeting's day (new
 * times there keep the series' first day too): the series' first
 * day (its DTSTART, which anchors the rule's implicit days; an added RDATE
 * meeting needn't share them), or, before the series loads, the
 * occurrence's place in the series (where the rule puts it). Any other
 * event's counts from the form's day. A new repeat or day starts the
 * series again elsewhere: `seriesRepeatForEdit` says where.
 */
export function repeatCountingDay(params: {
  event:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId">
    | null
    | undefined;
  /** The form's start day, in the series' zone. */
  formDay: Temporal.PlainDate | null;
  /** The series' own start (its master's), once loaded. */
  seriesStart?: StartTime | null;
  timeZone: string;
}): Temporal.PlainDate | null {
  const { event, formDay, timeZone } = params;
  if (!event?.recurringEventId) {
    return formDay;
  }
  const first = params.seriesStart
    ? dayOfStart(params.seriesStart, timeZone)
    : null;
  const placed = event.originalStartTime
    ? dayOfStart(event.originalStartTime, timeZone)
    : null;
  return first ?? placed ?? formDay;
}

/**
 * Why a new repeat, saved for the entire series, would cancel this
 * occurrence (null when it wouldn't, or before the series loads: the
 * scope rules wait for it). Google keeps an occurrence, a rescheduled one
 * too, only while the series' rule still produces its original slot
 * (`originalStartTime`), counted from the series' first meeting (its
 * DTSTART): a day left implicit (weekly with no days picked, monthly on
 * "Day N", yearly) comes from that first meeting, an interval counts its
 * weeks or months from it, and a COUNT or UNTIL can end the series before
 * the slot. The editor's words count from the occurrence instead, so
 * Entire series would then save something else and drop the very meeting
 * being edited.
 */
export function repeatSkipsOccurrence(params: {
  occurrence: Pick<
    GoogleEvent,
    "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The repeat the save sends. */
  recurrence: string[] | undefined;
  /** The series' own start (its master's), once loaded. */
  seriesStart?: StartTime | null;
  timeZone: string;
}): "day" | "end" | null {
  const { occurrence, recurrence, seriesStart } = params;
  if (!(occurrence.recurringEventId && seriesStart && recurrence?.length)) {
    return null;
  }
  return slotDropped({
    recurrence,
    seriesStart,
    slot: occurrence.originalStartTime ?? occurrence.start,
    timeZone: seriesTimeZone(occurrence, seriesStart, params.timeZone),
  });
}

/**
 * What an Entire series save would cost a meeting of the series changed
 * on its own (moved, renamed, any field the series doesn't share), and
 * the earliest such meeting's day as the calendar shows it: the server
 * refuses the save then, as Google would apply it. Google ties such a
 * meeting to its original slot. It cancels every one when the series'
 * start moves, its time or its day ("newStart"), and each one whose slot
 * a new repeat no longer has ("lostSlot"); a new length alone keeps them
 * but gives each the series' length ("ownLength", for one with a length
 * of its own other than the opened one, which takes the edit's).
 */
export interface EntireSeriesCost {
  /** The earliest meeting's day, in the app's zone. */
  day: Temporal.PlainDate;
  reason: "lostSlot" | "newStart" | "ownLength";
}

/**
 * What an Entire series save would cost the series' meetings changed on
 * their own, as the server reads it (`EntireSeriesCost`), among those
 * `loaded` (the opened one too); null when it costs none. Only the
 * meetings the app has loaded are seen; the server checks them all.
 */
export function entireSeriesCost(params: {
  /** The edited start and end, as the save sends them. */
  edited: { end: EventTime; start: EventTime };
  /** The series' occurrences the app has loaded (from its events cache). */
  loaded: GoogleEvent[];
  /** The series' own event, loaded. */
  master: GoogleEvent;
  occurrence: Pick<
    GoogleEvent,
    "end" | "id" | "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The repeat the save sends; undefined keeps the series'. */
  recurrence: string[] | undefined;
  timeZone: string;
}): EntireSeriesCost | null {
  const { edited, master, occurrence } = params;
  if (!occurrence.recurringEventId) {
    return null;
  }
  const zone = seriesTimeZone(occurrence, master.start, params.timeZone);
  const times = entireSeriesTimes({ edited, master, occurrence, zone });
  const seriesZone = master.start.timeZone ?? times.start.timeZone ?? zone;
  // As the server writes it with the series' new start (its ruleForStart).
  const recurrence = matchRecurrenceToStart(
    params.recurrence ?? master.recurrence ?? [],
    times.start,
    seriesZone,
    master.start
  );
  const movesStart = !sameTime(times.start, master.start, zone);
  const movesSlots =
    movesStart ||
    JSON.stringify(recurrence) !== JSON.stringify(master.recurrence ?? []);
  const resizes = !sameLength(times, master, zone);
  if (!(movesSlots || resizes)) {
    return null;
  }
  const changed = params.loaded.flatMap((event) => {
    const original = event.originalStartTime;
    const slot = original?.dateTime ?? original?.date;
    const own =
      original &&
      event.recurringEventId === master.id &&
      Object.keys(ownChanges(event, master, slotAt(master, original), zone))
        .length > 0;
    return own && slot ? [{ event, original, slot }] : [];
  });
  /** The earliest by original day, named by the day it's on now. */
  const earliest = (
    meetings: typeof changed,
    reason: EntireSeriesCost["reason"]
  ): EntireSeriesCost | null => {
    // ISO days sort as text.
    const slotDay = (meeting: (typeof changed)[number]) =>
      dayOfStart(meeting.original, zone)?.toString() ?? "";
    const [first] = [...meetings].sort((a, b) =>
      slotDay(a).localeCompare(slotDay(b))
    );
    const day = first && dayOfStart(first.event.start, params.timeZone);
    return day ? { day, reason } : null;
  };
  // A new length alone moves no slot, so none is checked.
  const lost = changed.filter(
    ({ slot }) =>
      movesStart ||
      (movesSlots &&
        seriesMeetsAt({ recurrence, seriesZone, slot, start: times.start }) !==
          true)
  );
  if (lost.length > 0) {
    return earliest(lost, movesStart ? "newStart" : "lostSlot");
  }
  if (!resizes) {
    return null;
  }
  return earliest(
    changed.filter(
      ({ event }) =>
        event.id !== occurrence.id && !sameLength(event, master, zone)
    ),
    "ownLength"
  );
}

/**
 * What a This and following save from `occurrence` would cost a later
 * meeting changed on its own, as the server reads it (its placeCarried):
 * the new series carries each meeting after the split changed on its own
 * (by fields the save doesn't set for the series) to its place in it (as
 * many days on as the series moved, `placeInNewSeries`; an added one at
 * its own slot), and refuses the save where the new series has no meeting
 * there ("lostSlot"), or can't carry its times at all, a timed meeting in
 * a series made all day or the reverse ("newStart"). The earliest such
 * meeting among those `loaded`, by original day, named by its day now;
 * null when none. Only the meetings the app has loaded are seen.
 */
export function followingCost(params: {
  /** The save as it sends the opened occurrence: its times and fields. */
  edited: Partial<CreateEvent> & { end: EventTime; start: EventTime };
  loaded: GoogleEvent[];
  master: GoogleEvent;
  occurrence: GoogleEvent;
  /** The repeat the save sends; undefined keeps the series'. */
  recurrence: string[] | undefined;
  timeZone: string;
}): EntireSeriesCost | null {
  const { edited, master, occurrence } = params;
  const original = occurrence.originalStartTime;
  if (!(occurrence.recurringEventId && original)) {
    return null;
  }
  const zone = seriesTimeZone(occurrence, master.start, params.timeZone);
  const splitAt = seriesSlotOf(original, zone);
  const splitMoment = splitAt && slotInstant(splitAt, zone);
  if (!(splitAt && splitMoment)) {
    return null;
  }
  // The new series' start: the opened occurrence's slot while the save
  // keeps its times, else the edit's.
  const start = keepsTimes(edited, occurrence, zone)
    ? slotAt(master, original).start
    : edited.start;
  const recurrence = newSeriesRule({
    master,
    recurrence: params.recurrence,
    splitAt,
    start,
    zone,
  });
  const later = laterOwnChanges({
    forSeries: changedFields(edited, occurrence),
    loaded: params.loaded,
    master,
    occurrence,
    splitMoment,
    zone,
  });
  const lost = unplaced({ later, master, recurrence, splitAt, start, zone });
  const slotDay = (event: GoogleEvent) =>
    (event.originalStartTime &&
      dayOfStart(event.originalStartTime, zone)?.toString()) ??
    "";
  const [first] = [...lost].sort((a, b) =>
    slotDay(a.event).localeCompare(slotDay(b.event))
  );
  const day = first && dayOfStart(first.event.start, params.timeZone);
  return first && day ? { day, reason: first.reason } : null;
}

/**
 * The meetings `later` the new series can't carry, and why: each goes to
 * its place in the new series, which must meet there, one meeting to a
 * slot (two that land on one both lose theirs).
 */
function unplaced(params: {
  later: { event: GoogleEvent; slot: string }[];
  master: GoogleEvent;
  recurrence: string[];
  splitAt: string;
  start: EventTime;
  zone: string;
}): { event: GoogleEvent; reason: EntireSeriesCost["reason"] }[] {
  const { later, master, recurrence, splitAt, start, zone } = params;
  const placed = new Map<number, GoogleEvent>();
  const lost: { event: GoogleEvent; reason: EntireSeriesCost["reason"] }[] = [];
  for (const { event, slot } of later) {
    const at = addsSlot(master.recurrence ?? [], slot, zone)
      ? sameForm(slot, start)
      : placeInNewSeries({
          newStart: start,
          originalStart: slot,
          splitStart: splitAt,
          zone,
        });
    const met =
      at &&
      seriesMeetsAt({ recurrence, seriesZone: zone, slot: at, start }) === true
        ? slotInstant(at, zone)
        : null;
    const taken = met && placed.get(met.epochMilliseconds);
    if (met && !taken) {
      placed.set(met.epochMilliseconds, event);
      continue;
    }
    lost.push({ event, reason: at ? "lostSlot" : "newStart" });
    if (taken) {
      lost.push({ event: taken, reason: "lostSlot" });
    }
  }
  return lost;
}

/**
 * The loaded meetings of `master` after the split (`splitMoment`), other
 * than the opened one, with changes of their own the save doesn't set for
 * the series (`forSeries`), each with its original slot.
 */
function laterOwnChanges(params: {
  forSeries: Partial<CreateEvent>;
  loaded: GoogleEvent[];
  master: GoogleEvent;
  occurrence: Pick<GoogleEvent, "id">;
  splitMoment: Temporal.Instant;
  zone: string;
}): { event: GoogleEvent; slot: string }[] {
  const { master, zone } = params;
  return params.loaded.flatMap((event) => {
    const slot =
      event.recurringEventId === master.id &&
      event.id !== params.occurrence.id &&
      event.originalStartTime
        ? seriesSlotOf(event.originalStartTime, zone)
        : null;
    const moment = slot && slotInstant(slot, zone);
    if (
      !(slot && moment) ||
      Temporal.Instant.compare(moment, params.splitMoment) <= 0
    ) {
      return [];
    }
    const own = Object.keys(
      ownChanges(
        event,
        master,
        slotAt(master, event.originalStartTime ?? event.start),
        zone
      )
    ).filter((field) => !(field in params.forSeries));
    return own.length > 0 ? [{ event, slot }] : [];
  });
}

/**
 * The rule a This and following save's new series repeats by, as the
 * server writes it: from the split on (its added days before it stay with
 * the old series), its COUNT carried on where the app can count it, and
 * lined up with the new start from the split (its ruleForStart).
 */
function newSeriesRule(params: {
  master: GoogleEvent;
  recurrence: string[] | undefined;
  splitAt: string;
  start: EventTime;
  zone: string;
}): string[] {
  const { master, splitAt, start, zone } = params;
  const masterRecurrence = master.recurrence ?? [];
  const fromSplit = splitAddedDays(
    params.recurrence ?? masterRecurrence,
    splitAt,
    zone,
    "from"
  );
  const count = countOf(masterRecurrence);
  const counted =
    count !== undefined && countOf(fromSplit) === count
      ? (carryCountExactly(fromSplit, {
          masterRecurrence,
          originalStart: splitAt,
          seriesStart: seriesSlotOf(master.start, zone) ?? splitAt,
          seriesZone: zone,
        }) ?? fromSplit)
      : fromSplit;
  const timedSplit = !DATE_ONLY.test(splitAt);
  const splitClock = timedSplit
    ? Temporal.Instant.from(splitAt).toZonedDateTimeISO(zone).toPlainTime()
    : null;
  const days =
    start.date && splitClock
      ? { firstDay: Temporal.PlainDate.from(start.date), firstTime: splitClock }
      : undefined;
  return matchRecurrenceToStart(
    counted,
    start,
    zone,
    timedSplit ? { dateTime: splitAt } : master.start,
    days
  );
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `slot` when it has `start`'s form (a date, or a date-time); else null. */
function sameForm(slot: string, start: EventTime): string | null {
  return DATE_ONLY.test(slot) === Boolean(start.date) ? slot : null;
}

/** A slot's moment: its own, or its date's start in `zone`. */
function slotInstant(slot: string, zone: string): Temporal.Instant | null {
  return DATE_ONLY.test(slot)
    ? Temporal.PlainDate.from(slot).toZonedDateTime(zone).toInstant()
    : startInstant({ dateTime: slot }, zone);
}

/**
 * A start as its series' slot, as the server reads one (its `slotOf`): a
 * date, or a date-time with the series' offset (one Google wrote without
 * an offset read in its own zone). Null when it has neither.
 */
export function seriesSlotOf(
  start: StartTime,
  seriesZone: string
): string | null {
  if (start.date) {
    return start.date;
  }
  const moment = startInstant(start, seriesZone);
  return moment ? googleDateTime(moment.toZonedDateTimeISO(seriesZone)) : null;
}

/**
 * Whether an Entire series save made through `occurrence` moves the
 * series' start (its time, its day through its first meeting, or its
 * all-day form), as the server reads it: a new length alone doesn't.
 * Before the series loads (`master` null), any new time might. For
 * `EventSaveChanges`' `retimed`.
 */
export function entireSeriesStartMoves(params: {
  edited: { end: EventTime; start: EventTime };
  master: GoogleEvent | null;
  occurrence: Pick<GoogleEvent, "end" | "originalStartTime" | "start">;
  timeZone: string;
}): boolean {
  const { edited, master, occurrence } = params;
  const zone = seriesTimeZone(occurrence, master?.start, params.timeZone);
  if (!master) {
    return !keepsTimes(edited, occurrence, zone);
  }
  const { start } = entireSeriesTimes({ edited, master, occurrence, zone });
  return !sameTime(start, master.start, zone);
}

/**
 * Whether an Entire series save made through `occurrence` gives a series
 * meeting more than once a day a new time of day, which the server
 * refuses (its movesSeveralADay): its rules would be mixed up. A new day,
 * length or all-day form keeps every meeting's time. For
 * `EventSaveChanges`' `movesSeveralADay`.
 */
export function entireSeriesMovesSeveralADay(params: {
  edited: { end: EventTime; start: EventTime };
  master: GoogleEvent;
  occurrence: Pick<GoogleEvent, "end" | "originalStartTime" | "start">;
  timeZone: string;
}): boolean {
  const { edited, master, occurrence } = params;
  const zone = seriesTimeZone(occurrence, master.start, params.timeZone);
  const { start } = entireSeriesTimes({ edited, master, occurrence, zone });
  const from = timeOfStart(master.start, zone);
  const to = timeOfStart(start, zone);
  return Boolean(
    from &&
      to &&
      Temporal.PlainTime.compare(from, to) !== 0 &&
      meetsSeveralTimesADay(master.recurrence ?? [], from)
  );
}

/**
 * The series' start and end after an Entire series save made through
 * `occurrence`, as the server sets them (its entireSeriesTimes): its own
 * while the edit keeps the occurrence's times; the edit's through the
 * series' first meeting; otherwise the edit's time of day and length on
 * the series' first day.
 */
function entireSeriesTimes(params: {
  edited: { end: EventTime; start: EventTime };
  master: GoogleEvent;
  occurrence: Pick<GoogleEvent, "end" | "originalStartTime" | "start">;
  zone: string;
}): { end: EventTime; start: EventTime } {
  const { edited, master, occurrence, zone } = params;
  const kept = { end: master.end, start: master.start };
  if (keepsTimes(edited, occurrence, zone)) {
    return kept;
  }
  if (
    sameTime(
      occurrence.originalStartTime ?? occurrence.start,
      master.start,
      zone
    )
  ) {
    return edited;
  }
  return (
    seriesTimesForEdit({
      editedEnd: edited.end,
      editedStart: edited.start,
      masterEnd: master.end,
      masterStart: master.start,
    }) ?? kept
  );
}

/**
 * The series' own slot at an occurrence's original start: there, with the
 * series' length (days when all day), as the server compares a meeting
 * with it to tell whether it moved.
 */
function slotAt(
  master: Pick<GoogleEvent, "end" | "start">,
  original: EventTime
): Pick<GoogleEvent, "end" | "start"> {
  if (master.start.date && master.end.date && original.date) {
    const days = Math.max(
      1,
      Temporal.PlainDate.from(master.start.date).until(master.end.date).days
    );
    const day = Temporal.PlainDate.from(original.date);
    return {
      end: { date: day.add({ days }).toString() },
      start: { date: original.date },
    };
  }
  const zone = master.start.timeZone ?? "UTC";
  const from = startInstant(master.start, zone);
  const to = startInstant(master.end, zone);
  const at = startInstant(original, zone);
  if (!(from && to && at)) {
    return { end: master.end, start: original };
  }
  return {
    end: {
      dateTime: at.add(from.until(to)).toString(),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: original,
  };
}

/**
 * Replaced by `entireSeriesCost` (an `EntireSeriesCost`: every change
 * the server keeps, under a new repeat, start or length); kept until the
 * app layers switch.
 *
 * The series' first moved (rescheduled) meeting, among those `loaded`,
 * that a new repeat saved for the entire series would cancel: Google keeps
 * one only while the rule still produces its original slot. The day it's
 * on now in `timeZone` (the app's), for the scope dialog to name; null
 * when none would go, or before the series loads. The edited occurrence
 * is `repeatSkipsOccurrence`'s.
 */
export function movedMeetingDropped(params: {
  /** The series' occurrences the app has loaded (from its events cache). */
  loaded: Pick<
    GoogleEvent,
    "id" | "originalStartTime" | "recurringEventId" | "start"
  >[];
  occurrence: Pick<GoogleEvent, "id" | "recurringEventId" | "start">;
  /** The repeat the save sends. */
  recurrence: string[] | undefined;
  /** The series' own start (its master's), once loaded. */
  seriesStart?: StartTime | null;
  timeZone: string;
}): Temporal.PlainDate | null {
  const { occurrence, recurrence, seriesStart } = params;
  if (!(occurrence.recurringEventId && seriesStart && recurrence?.length)) {
    return null;
  }
  const timeZone =
    seriesStart.timeZone ?? eventTimeZone(occurrence, params.timeZone);
  const dropped = params.loaded.flatMap((event) => {
    const slot = event.originalStartTime;
    const moved =
      event.recurringEventId === occurrence.recurringEventId &&
      event.id !== occurrence.id &&
      slot &&
      !sameTime(event.start, slot, timeZone);
    if (!moved) {
      return [];
    }
    return slotDropped({ recurrence, seriesStart, slot, timeZone })
      ? [{ slot, start: event.start }]
      : [];
  });
  // Earliest original day first (ISO days sort as text).
  const slotDay = (event: (typeof dropped)[number]) =>
    dayOfStart(event.slot, timeZone)?.toString() ?? "";
  const [first] = dropped.sort((a, b) => slotDay(a).localeCompare(slotDay(b)));
  return first ? dayOfStart(first.start, params.timeZone) : null;
}

/**
 * Why `recurrence` no longer has `slot`, an occurrence's original start,
 * as the server reads it (`seriesMeetsAt`: the series' first meeting, an
 * added RDATE one, or a rule's, skipped ones aside): "end" when a rule at
 * the slot's time still has its day but its COUNT or UNTIL comes first,
 * else "day" (not a rule's day or time: an implicit day, an interval's
 * phase, another time of day).
 * Null while the series still has it, or when that can't be told.
 */
function slotDropped(params: {
  recurrence: string[];
  seriesStart: StartTime;
  slot: StartTime;
  timeZone: string;
}): "day" | "end" | null {
  const { recurrence, seriesStart, slot, timeZone } = params;
  const slotText = slot.dateTime ?? slot.date;
  const meets =
    slotText &&
    seriesMeetsAt({
      recurrence,
      seriesZone: timeZone,
      slot: slotText,
      start: seriesStart,
    });
  if (meets !== false) {
    return null;
  }
  const first = dayOfStart(seriesStart, timeZone);
  const day = dayOfStart(slot, timeZone);
  const seriesTime = timeOfStart(seriesStart, timeZone);
  const slotTime = timeOfStart(slot, timeZone);
  // Only a rule at the slot's time could have had it.
  const slotRules = recurrence
    .filter(isRule)
    .filter(
      (rule) =>
        !(seriesTime && slotTime) ||
        Temporal.PlainTime.compare(ruleClock(rule, seriesTime), slotTime) === 0
    );
  const onItsDay = Boolean(
    first &&
      day &&
      slotRules.some((rule) => isRuleDay(rule, first, day) === true)
  );
  return onItsDay ? "end" : "day";
}

/**
 * The day an "Ends on" date defaults to: three months
 * (`defaultUntilDay`) after the occurrence's own day (not the series'
 * first, which can be years back), or after today when that's later, in
 * the series' zone.
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

/**
 * Whether a save moves an occurrence's series to another day: the edit
 * changes its times, and its new start is on another day than its place
 * in the series (its original start; a rescheduled one's was where it was
 * moved from). An edit that keeps its times keeps the series' slot, as the
 * server reads it (`keepsTimes`): one rescheduled before, then only
 * renamed, hasn't moved, and one moved back onto its own day hasn't either.
 */
export function occurrenceDayMoved(params: {
  editedEnd: EventTime;
  editedStart: EventTime;
  occurrence: Pick<
    GoogleEvent,
    "end" | "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The series' own start (its master's), once loaded: its zone. */
  seriesStart?: StartTime | null;
  timeZone: string;
}): boolean {
  const { editedEnd, editedStart, occurrence } = params;
  if (!occurrence.recurringEventId) {
    return false;
  }
  const timeZone = seriesTimeZone(
    occurrence,
    params.seriesStart,
    params.timeZone
  );
  const edited = { end: editedEnd, start: editedStart };
  if (keepsTimes(edited, occurrence, timeZone)) {
    return false;
  }
  const from = dayOfStart(
    occurrence.originalStartTime ?? occurrence.start,
    timeZone
  );
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
  /** The edited end. */
  editedEnd: EventTime;
  /** The edited start. */
  editedStart: EventTime;
  masterRecurrence: string[] | null | undefined;
  /** The series' own start, its first day (where COUNT counts from). */
  masterStart?: StartTime | null;
  occurrence: Pick<
    GoogleEvent,
    "end" | "originalStartTime" | "recurringEventId" | "start"
  >;
  /** The rule the save already sends, if any. */
  recurrence: string[] | undefined;
  timeZone: string;
}): string[] | undefined {
  const { editedEnd, editedStart, masterRecurrence, occurrence } = params;
  const timeZone = seriesTimeZone(
    occurrence,
    params.masterStart,
    params.timeZone
  );
  if (
    params.recurrence !== undefined ||
    !occurrence.recurringEventId ||
    !masterRecurrence?.length
  ) {
    return;
  }
  // The rule follows only a day the save moves the series to, from the
  // occurrence's place in the series (where the rule puts it, even if it
  // was rescheduled before). Without one, nothing is sent: an edit that
  // keeps the occurrence's times keeps the series' own (renaming one
  // rescheduled before mustn't retarget the series to it), and a new time
  // or form (All day) on its own day is lined up with the series' own
  // rule, freshly read, on the server, so a copy cached here can't write
  // an old rule back.
  if (
    !occurrenceDayMoved({
      editedEnd,
      editedStart,
      occurrence,
      seriesStart: params.masterStart,
      timeZone,
    })
  ) {
    return;
  }
  const allDay = Boolean(editedStart.date);
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
  masterStart: StartTime | null | undefined,
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

/**
 * Whether a series repeats by more than one RRULE (Mondays at 9:00, and
 * Mondays at 15:00, as two lines): EXDATE and RDATE lines don't count.
 */
export function hasSeveralRules(
  recurrence: string[] | null | undefined
): boolean {
  return (recurrence ?? []).filter(isRule).length > 1;
}

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
