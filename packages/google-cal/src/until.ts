/**
 * Reading a series' times (its EXDATE/RDATE values, and a start's moment,
 * clock and length), and writing its recurrence in its start's form.
 */
import { Temporal } from "temporal-polyfill";
import {
  isRuleDay,
  meetsSeveralTimesADay,
  readRule,
  WEEKDAY_CODES,
} from "./series";

/** A Google date ("2026-11-16"), as an all-day start writes it. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;
/**
 * A time part a rule sets to one value. Google meets a rule once a day, at
 * the start's time, and ignores a list ("BYHOUR=9,15"), so a list reads as
 * left out.
 */
const CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g;
const TIME_PART = /^BY(?:HOUR|MINUTE|SECOND)=/;
const SUB_DAILY = /FREQ=(?:HOURLY|MINUTELY|SECONDLY)/;
const FREQ_PART = /FREQ=([A-Z]+)/;
const INTERVAL_PART = /INTERVAL=(\d+)/;
const COUNT_PART = /COUNT=\d+/;
const BY_MONTH_PART = /BYMONTH=([^;]*)/;
const BY_MONTH_DAY_PART = /BYMONTHDAY=/;
const BY_DAY_PART = /BYDAY=([^;]*)/;
const WEEK_START_PART = /WKST=([A-Z]{2})/;
const DAY_NS = 86_400_000_000_000;
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

/**
 * A start as Google writes it: a date (all day) or a date-time, which may
 * leave out its offset when it names its time zone.
 */
interface StartTime {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
}

/** A zoned time as a Google date-time, "2026-10-06T09:00:00-04:00". */
export function googleDateTime(time: Temporal.ZonedDateTime): string {
  return time.toString({ smallestUnit: "second", timeZoneName: "never" });
}

/** A date-time's offset ("-05:00" or "Z"), at its end. */
export const OFFSET = /([+-]\d{2}:\d{2}|Z)$/;

/**
 * The moment a Google dateTime names. Google allows one without an offset
 * when a time zone comes with it: read in `timeZone`. Null if it doesn't
 * parse.
 */
function instantOf(
  dateTime: string,
  timeZone: string
): Temporal.Instant | null {
  try {
    return OFFSET.test(dateTime)
      ? Temporal.Instant.from(dateTime)
      : Temporal.PlainDateTime.from(dateTime)
          .toZonedDateTime(timeZone)
          .toInstant();
  } catch {
    return null;
  }
}

/**
 * A timed start's moment; one without an offset is read in its own zone,
 * else `timeZone`. Null for a date (all day) or one that doesn't parse.
 */
export function startInstant(
  start: StartTime,
  timeZone: string
): Temporal.Instant | null {
  return start.dateTime
    ? instantOf(start.dateTime, start.timeZone ?? timeZone)
    : null;
}

/**
 * The local day a Google start falls on in `timeZone` (an all-day one's
 * date); null when it has neither or doesn't parse.
 */
export function dayOfStart(
  start: StartTime,
  timeZone: string
): Temporal.PlainDate | null {
  if (start.date) {
    try {
      return Temporal.PlainDate.from(start.date);
    } catch {
      return null;
    }
  }
  return (
    startInstant(start, timeZone)?.toZonedDateTimeISO(timeZone).toPlainDate() ??
    null
  );
}

/**
 * A Google start's moment: its date-time (see `startInstant`), or the
 * start of its date in `timeZone`; null when it doesn't parse.
 */
export function momentOf(
  start: StartTime,
  timeZone: string
): Temporal.Instant | null {
  if (start.dateTime) {
    return startInstant(start, timeZone);
  }
  return (
    dayOfStart(start, timeZone)?.toZonedDateTime({ timeZone }).toInstant() ??
    null
  );
}

/** A timed event's length in ms; null if a time doesn't parse. */
export function lengthMs(
  start: StartTime,
  end: StartTime,
  timeZone: string
): number | null {
  const from = startInstant(start, timeZone);
  const to = startInstant(end, timeZone);
  return from && to ? to.epochMilliseconds - from.epochMilliseconds : null;
}

/** A timed start's wall-clock time in `timeZone`; null all day. */
export function clockOf(
  start: StartTime,
  timeZone: string
): Temporal.PlainTime | null {
  return (
    startInstant(start, timeZone)?.toZonedDateTimeISO(timeZone).toPlainTime() ??
    null
  );
}

/** A recurrence value: its day in the series' zone, its moment if timed. */
export interface RecurrenceValue {
  day: Temporal.PlainDate;
  instant: Temporal.Instant | null;
}

/**
 * Reads "20261128", "20261128T140000Z", "20261128T090000" (a local time
 * in `valueZone`, its line's TZID) or a Google date-time as the day it
 * falls on in `seriesZone`: a Tokyo series' Monday skipped as "Sunday
 * 19:00 New York" is Monday. Null when it doesn't parse.
 */
export function readRecurrenceValue(
  value: string,
  valueZone: string,
  seriesZone: string
): RecurrenceValue | null {
  try {
    // Stripping a Google date-time's dashes would strip its offset's minus.
    if (ISO_DATE_TIME.test(value)) {
      return inZone(Temporal.Instant.from(value), seriesZone);
    }
    const cleaned = value.replace(/[-:]/g, "");
    const date = UNTIL_DATE.exec(cleaned);
    if (date) {
      const [, y, m, d] = date;
      return { day: Temporal.PlainDate.from(`${y}-${m}-${d}`), instant: null };
    }
    const full = UNTIL_DATE_TIME.exec(cleaned);
    if (!full) {
      return null;
    }
    const [, y, m, d, hh, mm, ss, offset] = full;
    const local = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
    if (!offset) {
      return inZone(
        Temporal.PlainDateTime.from(local)
          .toZonedDateTime(valueZone)
          .toInstant(),
        seriesZone
      );
    }
    const iso =
      offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    return inZone(Temporal.Instant.from(`${local}${iso}`), seriesZone);
  } catch {
    return null;
  }
}

function inZone(instant: Temporal.Instant, zone: string): RecurrenceValue {
  return { day: instant.toZonedDateTimeISO(zone).toPlainDate(), instant };
}

/** An EXDATE/RDATE line: its name, the zone its values are in, and them. */
function parseDateList(
  line: string,
  seriesZone: string
): { name: string; values: string[]; zone: string } | null {
  const match = DATE_LIST.exec(line);
  if (!match) {
    return null;
  }
  const [, name = "", params = "", list = ""] = match;
  return {
    name,
    values: list.split(","),
    zone: TZID_PARAM.exec(params)?.[1] ?? seriesZone,
  };
}

/**
 * The values of `recurrence`'s skipped (EXDATE) or added (RDATE) lines,
 * read in the series' zone; one that doesn't parse is left out.
 */
export function dateValues(
  recurrence: string[],
  name: "EXDATE" | "RDATE",
  seriesZone: string
): RecurrenceValue[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith(name) ? parseDateList(line, seriesZone) : null;
    return (list?.values ?? []).flatMap((value) => {
      const read = list && readRecurrenceValue(value, list.zone, seriesZone);
      return read ? [read] : [];
    });
  });
}

/**
 * `recurrence` with only the skipped (EXDATE) or added (RDATE) values
 * `keep` accepts, each line otherwise as written: a value that doesn't
 * parse stays, and a line left with none goes.
 */
export function keepingDateValues(
  recurrence: string[],
  name: "EXDATE" | "RDATE",
  seriesZone: string,
  keep: (value: RecurrenceValue) => boolean
): string[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith(name) ? parseDateList(line, seriesZone) : null;
    if (!list) {
      return [line];
    }
    const kept = list.values.filter((value) => {
      const read = readRecurrenceValue(value, list.zone, seriesZone);
      return !read || keep(read);
    });
    if (kept.length === list.values.length) {
      return [line];
    }
    return kept.length > 0
      ? [`${line.slice(0, line.indexOf(":") + 1)}${kept.join(",")}`]
      : [];
  });
}

function compactDate(day: Temporal.PlainDate): string {
  return day.toString().replace(/-/g, "");
}

/** "20261101T063000Z": a moment as a recurrence value, in UTC. */
function compactInstant(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
}

/** The start's wall-clock time in `timeZone`, midnight when all day. */
function wallClock(start: StartTime, timeZone: string): Temporal.PlainTime {
  return clockOf(start, timeZone) ?? Temporal.PlainTime.from("00:00");
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
    return compactDate(day);
  }
  return compactInstant(
    day.toZonedDateTime({ plainTime: "23:59:59", timeZone }).toInstant()
  );
}

/** The day an UNTIL (or any date / date-time value) falls on in `timeZone`. */
export function untilRuleToDay(
  until: string,
  timeZone: string
): Temporal.PlainDate | null {
  return readRecurrenceValue(until, timeZone, timeZone)?.day ?? null;
}

/** A rule's single value for a time part (BYHOUR=10); null for none or a list. */
function singlePart(rule: string, part: string): number | null {
  const value = rule
    .slice(rule.indexOf(":") + 1)
    .split(";")
    .find((entry) => entry.startsWith(`${part}=`))
    ?.slice(part.length + 1);
  return value && !value.includes(",") ? Number(value) : null;
}

/**
 * The time a rule meets at: the time parts it sets once, the rest the
 * start's (`base`). Without `base`, only a rule that sets them all has
 * one.
 */
function ruleClock(
  rule: string,
  base: Temporal.PlainTime | null
): Temporal.PlainTime | null {
  const hour = singlePart(rule, "BYHOUR") ?? base?.hour;
  const minute = singlePart(rule, "BYMINUTE") ?? base?.minute;
  const second = singlePart(rule, "BYSECOND") ?? base?.second;
  return hour === undefined || minute === undefined || second === undefined
    ? null
    : Temporal.PlainTime.from({ hour, minute, second });
}

/**
 * Whether rules meet at more than one time of day, read from their own
 * time parts when the series' time isn't known: a rule that steps within
 * a day, or two that set different times.
 */
function rulesDifferInTime(rules: string[]): boolean {
  const key = (rule: string) =>
    ["BYHOUR", "BYMINUTE", "BYSECOND"]
      .map((part) => singlePart(rule, part) ?? "*")
      .join(":");
  return (
    rules.some((rule) => SUB_DAILY.test(rule)) ||
    new Set(rules.map(key)).size > 1
  );
}

/**
 * Where a rule's meeting at `own` moves when the start moves to `start`:
 * the parts the rule sets stay, the rest follow the start.
 */
function withRuleClock(
  rule: string,
  own: Temporal.PlainTime,
  start: Temporal.PlainTime
): Temporal.PlainTime {
  const sets = new Set([...rule.matchAll(CLOCK_PART)].map((match) => match[1]));
  return Temporal.PlainTime.from({
    hour: sets.has("BYHOUR") ? own.hour : start.hour,
    minute: sets.has("BYMINUTE") ? own.minute : start.minute,
    second: sets.has("BYSECOND") ? own.second : start.second,
  });
}

/**
 * Where a rule's meeting at `own` lands when the pattern moves to `newRule`
 * from `start`: a time part the new rule sets once is its (BYHOUR=9 made
 * BYHOUR=10), else as `withRuleClock` keeps it.
 */
function movedClock(params: {
  newRule: string;
  oldRule: string;
  own: Temporal.PlainTime;
  start: Temporal.PlainTime;
}): Temporal.PlainTime {
  const kept = withRuleClock(params.oldRule, params.own, params.start);
  return Temporal.PlainTime.from({
    hour: singlePart(params.newRule, "BYHOUR") ?? kept.hour,
    minute: singlePart(params.newRule, "BYMINUTE") ?? kept.minute,
    second: singlePart(params.newRule, "BYSECOND") ?? kept.second,
  });
}

/**
 * How far a once-a-day series' meetings turn round the clock when its time
 * of day changes `from` one `to` another: on the start's own day
 * (`sameDay`), the change as it is; moved to another day too, its nearest
 * way round the clock (9:00 to the next day's 8:00 is an hour earlier,
 * 23:00 to the next day's 00:30 an hour and a half later).
 */
function clockTurn(
  from: Temporal.PlainTime,
  to: Temporal.PlainTime,
  sameDay: boolean
): Temporal.Duration {
  // In whole nanoseconds: a time with seconds (9:00:30) turns by a part of
  // a minute, which a duration in minutes can't hold.
  const change = from.until(to).total("nanoseconds");
  const turn = sameDay
    ? change
    : ((((change + DAY_NS / 2) % DAY_NS) + DAY_NS) % DAY_NS) - DAY_NS / 2;
  return Temporal.Duration.from({ nanoseconds: turn });
}

/**
 * The days a start moved by the clock, when the move is less than a day
 * (23:00 to the next day's 00:30 is one). Null for a longer move.
 */
function shortDayShift(
  from: StartTime,
  to: StartTime,
  timeZone: string
): number | null {
  const wall = (time: StartTime) =>
    startInstant(time, timeZone)
      ?.toZonedDateTimeISO(timeZone)
      .toPlainDateTime();
  const was = wall(from);
  const now = wall(to);
  if (!(was && now) || Math.abs(was.until(now).total("hours")) >= 24) {
    return null;
  }
  return was.toPlainDate().until(now.toPlainDate()).days;
}

/**
 * A once-a-day meeting's day once the series moves from `seriesStart` to
 * `start`: the first a rule (counted from `rulesFrom`) meets on of its
 * clock's turn's (`clockTurn`) and the start's whole move's (under a
 * day); else its own.
 */
function meetingDayMover(params: {
  rulesFrom: Temporal.PlainDate | null;
  seriesStart: StartTime | undefined;
  start: StartTime;
  timeZone: string;
}): (rule: string, day: Temporal.PlainDate) => Temporal.PlainDate {
  const { rulesFrom, seriesStart, start, timeZone } = params;
  if (!(seriesStart?.dateTime && start.dateTime)) {
    return (_rule, day) => day;
  }
  const from = wallClock(seriesStart, timeZone);
  const to = wallClock(start, timeZone);
  const fromDay = dayOfStart(seriesStart, timeZone);
  const toDay = dayOfStart(start, timeZone);
  const sameDay = Boolean(fromDay && toDay && fromDay.equals(toDay));
  const turnDays = Math.floor(
    (Temporal.PlainTime.from("00:00").until(from).total("nanoseconds") +
      clockTurn(from, to, sameDay).total("nanoseconds")) /
      DAY_NS
  );
  const dayMove = shortDayShift(seriesStart, start, timeZone);
  const moves = dayMove === null ? [turnDays] : [turnDays, dayMove];
  return (rule, day) => {
    const meets = moves.find(
      (move) =>
        !rulesFrom ||
        isRuleDay(rule, rulesFrom, day.add({ days: move })) !== false
    );
    return day.add({ days: meets ?? 0 });
  };
}

/**
 * An RRULE line with its UNTIL in the start's form, on the rule's last
 * day: a date-time UNTIL's own day, or the day before when that day's
 * meeting (at the rule's time, from `base`, the start's before the edit)
 * starts after it, as a split's cut, the second before its meeting, does.
 * A once-a-day series moved to a new time of day (`retimed`) ends at that
 * day's end too, so its last meeting stays and none is added.
 */
function matchUntil(
  line: string,
  params: {
    allDay: boolean;
    base: Temporal.PlainTime | null;
    /** The last meeting's day once it's at the new time (`retimed`). */
    moveDay: (line: string, day: Temporal.PlainDate) => Temporal.PlainDate;
    retimed: boolean;
    timeZone: string;
  }
): string {
  const { allDay, timeZone } = params;
  const match = UNTIL_PART.exec(line);
  const value = match?.[2]
    ? readRecurrenceValue(match[2], timeZone, timeZone)
    : null;
  if (!(match && value)) {
    return line;
  }
  const timed = value.instant !== null;
  if (timed !== allDay && !(timed && params.retimed)) {
    return line;
  }
  const clock = params.base && ruleClock(line, params.base);
  const meeting =
    value.instant && clock
      ? value.day.toZonedDateTime({ plainTime: clock, timeZone }).toInstant()
      : null;
  const day =
    meeting &&
    value.instant &&
    Temporal.Instant.compare(meeting, value.instant) > 0
      ? value.day.subtract({ days: 1 })
      : value.day;
  const lastDay = params.retimed ? params.moveDay(line, day) : day;
  return line.replace(
    UNTIL_PART,
    `${match[1]}UNTIL=${untilRuleForDay(lastDay, allDay, timeZone)}`
  );
}

/**
 * An RRULE with its BYHOUR / BYMINUTE / BYSECOND set to the start's (a
 * "BYHOUR=9" series moved to 10:00 would keep meeting at 9), or dropped
 * when made all day (`dropTimes`). A series that meets several times a
 * day keeps its own times.
 */
function matchClock(
  line: string,
  start: StartTime,
  how: { dropTimes: boolean; severalADay: boolean; timeZone: string }
): string {
  if (start.date && how.dropTimes && !SUB_DAILY.test(line)) {
    return `RRULE:${line
      .slice("RRULE:".length)
      .split(";")
      .filter((part) => !TIME_PART.test(part))
      .join(";")}`;
  }
  if (!start.dateTime || how.severalADay) {
    return line;
  }
  const time = wallClock(start, how.timeZone);
  const parts = {
    BYHOUR: time.hour,
    BYMINUTE: time.minute,
    BYSECOND: time.second,
  };
  return line.replace(
    CLOCK_PART,
    (whole, part: keyof typeof parts) => `${whole[0]}${part}=${parts[part]}`
  );
}

/** A series' added (RDATE) meetings with a time, as epoch milliseconds. */
function addedMoments(recurrence: string[], seriesZone: string): Set<number> {
  return new Set(
    dateValues(recurrence, "RDATE", seriesZone).flatMap((value) =>
      value.instant ? [value.instant.epochMilliseconds] : []
    )
  );
}

/** A series' all-day added (RDATE) days ("2026-11-16"). */
function addedDates(recurrence: string[], seriesZone: string): Set<string> {
  return new Set(
    dateValues(recurrence, "RDATE", seriesZone).flatMap((value) =>
      value.instant ? [] : [value.day.toString()]
    )
  );
}

/**
 * Made all day, which timed RDATE/EXDATE values become dates. A date covers
 * the whole day, so a cancelled added meeting leaves both lists, and a skip
 * becomes a date only when every meeting that day was skipped (the rules',
 * repeating from `first`, the added ones and the start) and no added date
 * meets then. Rules whose meetings can't be listed (no `first`) take the
 * skip as their meeting's.
 */
function allDayDates(params: {
  /** The rules' first meeting, their COUNT counted from it. */
  first: Temporal.ZonedDateTime | null;
  /** The series' start: a meeting whatever its rules and added days say. */
  start: Temporal.Instant | null;
  recurrence: string[];
  rules: string[];
  timeZone: string;
}): (name: string, value: RecurrenceValue) => boolean {
  const { first, recurrence, rules, start, timeZone } = params;
  const momentsOf = (name: "EXDATE" | "RDATE") =>
    dateValues(recurrence, name, timeZone).flatMap((value) =>
      value.instant ? [value.instant] : []
    );
  const skipped = new Set(momentsOf("EXDATE").map((m) => m.epochMilliseconds));
  const added = momentsOf("RDATE");
  const readers = first ? rules.map((rule) => readRule({ first, rule })) : [];
  // The rules' meetings on a day; null when they can't be listed.
  const ruleMeetingsOn = (day: Temporal.PlainDate): number[] | null => {
    if (!first || readers.some((reader) => reader === null)) {
      return null;
    }
    const from = day.toZonedDateTime({ timeZone }).toInstant();
    const to = day
      .add({ days: 1 })
      .toZonedDateTime({ timeZone })
      .toInstant()
      .subtract({ nanoseconds: 1 });
    return readers.flatMap((reader) =>
      (reader?.meetingsBetween(from, to) ?? []).flatMap((meeting) =>
        meeting instanceof Temporal.Instant ? [meeting.epochMilliseconds] : []
      )
    );
  };
  const dayOf = (moment: Temporal.Instant) =>
    moment.toZonedDateTimeISO(timeZone).toPlainDate();
  // An added meeting that was skipped adds nothing, unless a rule (or the
  // start) meets then too: that skip is the rule's meeting's.
  const cancelled = new Set(
    added
      .filter((moment) => {
        const ms = moment.epochMilliseconds;
        const listed = ruleMeetingsOn(dayOf(moment));
        return (
          skipped.has(ms) &&
          listed !== null &&
          !listed.includes(ms) &&
          ms !== start?.epochMilliseconds
        );
      })
      .map((moment) => moment.epochMilliseconds)
  );
  const skippedDays = new Set(
    dateValues(recurrence, "EXDATE", timeZone).flatMap((value) =>
      value.instant ? [] : [value.day.toString()]
    )
  );
  const liveAdded = added.filter(
    (moment) =>
      !(
        skipped.has(moment.epochMilliseconds) ||
        cancelled.has(moment.epochMilliseconds)
      )
  );
  const liveDays = new Set(
    [...addedDates(recurrence, timeZone)].filter((day) => !skippedDays.has(day))
  );
  return (name, value) => {
    const ms = value.instant?.epochMilliseconds;
    if (ms === undefined || cancelled.has(ms)) {
      return ms === undefined;
    }
    if (name !== "EXDATE") {
      return true;
    }
    // A day added whole (and not skipped whole), or a timed added meeting
    // still on, meets whatever else is skipped.
    if (
      liveDays.has(value.day.toString()) ||
      liveAdded.some((moment) => dayOf(moment).equals(value.day))
    ) {
      return false;
    }
    const listed = ruleMeetingsOn(value.day);
    if (!listed) {
      return true;
    }
    const meetings = [
      ...listed,
      ...(start && dayOf(start).equals(value.day)
        ? [start.epochMilliseconds]
        : []),
      ...added
        .filter(
          (moment) =>
            dayOf(moment).equals(value.day) &&
            !cancelled.has(moment.epochMilliseconds)
        )
        .map((moment) => moment.epochMilliseconds),
    ];
    return (
      meetings.length > 0 && meetings.every((meeting) => skipped.has(meeting))
    );
  };
}

/** How `matchDateList` reads a series' skipped and added values. */
interface DateListMatch {
  /** The series' added (RDATE) meetings, as epoch milliseconds. */
  added: Set<number>;
  /**
   * Whether a skip where nothing met, one the series had before the edit,
   * now cancels a meeting of the saved rules (the series moved onto it).
   */
  cancelsMeeting: (instant: Temporal.Instant) => boolean;
  /** Made all day: whether a timed value becomes a date. */
  keepAsDate: ((name: string, value: RecurrenceValue) => boolean) | null;
  /** A once-a-day meeting's day at the new time (`meetingDayMover`). */
  moveDay: (day: Temporal.PlainDate) => Temporal.PlainDate;
  /** Whether a skip was on a rule's or the start's meeting before the edit. */
  ownSlot: ((value: RecurrenceValue) => boolean) | null;
  seriesZone: string;
  /** The series meets several times a day: its skipped times are its own. */
  severalADay: boolean;
}

/**
 * An EXDATE/RDATE line in the start's form: dates for an all-day series;
 * for a timed one, each skip at the start's time on its day, so it stays
 * skipped when that time moves. RDATE times stay as they are, as do a
 * series' that meets several times a day.
 */
function matchDateList(
  line: string,
  start: StartTime,
  how: DateListMatch
): string {
  const { added, keepAsDate, ownSlot, seriesZone } = how;
  const list = parseDateList(line, seriesZone);
  if (!list) {
    return line;
  }
  const values = list.values.flatMap((value) => {
    const read = readRecurrenceValue(value, list.zone, seriesZone);
    return read ? [read] : [];
  });
  if (values.length < list.values.length) {
    return line;
  }
  if (start.date) {
    if (values.every((value) => value.instant === null)) {
      return line;
    }
    const days = [
      ...new Set(
        values
          .filter(
            (value) =>
              !(value.instant && keepAsDate) || keepAsDate(list.name, value)
          )
          .map((value) => compactDate(value.day))
      ),
    ];
    return days.length > 0 ? `${list.name};VALUE=DATE:${days.join(",")}` : "";
  }
  const timed = values.every((value) => value.instant);
  if (how.severalADay || (list.name === "RDATE" && timed)) {
    return line;
  }
  const time = wallClock(start, seriesZone);
  const addedOn = (day: Temporal.PlainDate) =>
    [...added]
      .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms))
      .filter((at) =>
        at.toZonedDateTimeISO(seriesZone).toPlainDate().equals(day)
      );
  // A skipped added meeting keeps its time. If a rule's (or the start's)
  // meeting was there too, it's also skipped at the new time, where that
  // meeting moves. A skip never moves onto an added meeting: it would
  // cancel it.
  const moments = values.flatMap((value) => {
    const kept = value.instant;
    const moment = (kept ? how.moveDay(value.day) : value.day)
      .toZonedDateTime({ plainTime: time, timeZone: seriesZone })
      .toInstant();
    // A date skipped the whole day: its added meetings too.
    if (list.name === "EXDATE" && !kept) {
      return [moment, ...addedOn(value.day)];
    }
    // A skip where nothing met skips nothing: it stays as it is, so it
    // can't land on a meeting.
    if (list.name === "EXDATE" && kept && ownSlot && !ownSlot(value)) {
      return how.cancelsMeeting(kept) ? [] : [kept];
    }
    if (
      !(
        list.name === "EXDATE" &&
        kept &&
        (added.has(kept.epochMilliseconds) ||
          added.has(moment.epochMilliseconds))
      )
    ) {
      return [moment];
    }
    const moves =
      ownSlot?.(value) &&
      !added.has(moment.epochMilliseconds) &&
      Temporal.Instant.compare(moment, kept) !== 0;
    return moves ? [kept, moment] : [kept];
  });
  const same =
    moments.length === values.length &&
    moments.every((moment, index) => {
      const own = values[index]?.instant;
      return own ? Temporal.Instant.compare(moment, own) === 0 : false;
    });
  if (same) {
    return line;
  }
  return moments.length > 0
    ? `${list.name}:${[...new Set(moments.map(compactInstant))].join(",")}`
    : "";
}

/**
 * Where a series made all day repeats its rules from, at its time `base`:
 * the day they count from (`anchor`), or, for a COUNT, the series' first
 * day (`firstDay`, the new start's when left out; null when not known).
 * Null when either can't be told.
 */
function countedFirst(params: {
  anchor: Temporal.PlainDate | null;
  base: Temporal.PlainTime | null;
  firstDay: Temporal.PlainDate | null | undefined;
  rules: string[];
  start: StartTime;
  timeZone: string;
}): Temporal.ZonedDateTime | null {
  const { base, firstDay, start, timeZone } = params;
  const counts = params.rules.some((rule) => COUNT_PART.test(rule));
  const countFrom =
    firstDay === undefined && start.date
      ? Temporal.PlainDate.from(start.date)
      : firstDay;
  const day = counts && countFrom !== undefined ? countFrom : params.anchor;
  return day && base
    ? day.toZonedDateTime({ plainTime: base, timeZone })
    : null;
}

/**
 * Whether a skip at `instant` where nothing met, one the series had before
 * the edit (`before`), now cancels a meeting of the saved `rules` (the
 * series moved onto it): it goes then. One standing for that day's
 * meeting, skipped before the edit, stays (a client moved it there). A
 * client's own skip, lined up for the new start, can't be told from a
 * stale one, so only a caller that knows `before` drops any.
 */
function staleSkipCancels(params: {
  base: Temporal.PlainTime | null;
  before: readonly string[];
  rules: string[];
  start: StartTime;
  timeZone: string;
}): (instant: Temporal.Instant) => boolean {
  const { base, timeZone } = params;
  const had = new Set(
    dateValues([...params.before], "EXDATE", timeZone).flatMap((value) =>
      value.instant ? [value.instant.epochMilliseconds] : []
    )
  );
  const day = dayOfStart(params.start, timeZone);
  const time = clockOf(params.start, timeZone);
  const first =
    day && time ? day.toZonedDateTime({ plainTime: time, timeZone }) : null;
  const dayMeetingSkipped = (instant: Temporal.Instant) =>
    base !== null &&
    had.has(
      instant
        .toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toZonedDateTime({ plainTime: base, timeZone }).epochMilliseconds
    );
  const readers = first
    ? params.rules.map((rule) => readRule({ first, rule }))
    : [];
  return (instant) =>
    had.has(instant.epochMilliseconds) &&
    !dayMeetingSkipped(instant) &&
    readers.some((reader) => reader?.meetsAt(instant) === true);
}

/**
 * `recurrence` in the form `start` takes: UNTIL, EXDATE and RDATE values
 * as dates for an all-day series, date-times for a timed one, with skips
 * kept on their meetings. The same array when nothing changes.
 * `seriesStart` is the start before the edit; `timeZone` is the series'.
 */
export function matchRecurrenceToStart(
  recurrence: string[],
  start: StartTime,
  timeZone: string,
  seriesStart?: StartTime,
  days?: {
    /** The day the rules count from, when it isn't the new start's. */
    rulesFrom?: Temporal.PlainDate;
    /**
     * The series' first day (COUNT counts from it); null if not known.
     * Left out, the new start's.
     */
    firstDay?: Temporal.PlainDate | null;
    /**
     * The series' rules before the edit. An UNTIL they don't have was set
     * for the new start, so it's read at its time, not the old one.
     */
    before?: readonly string[];
    /**
     * The first meeting's time, when not `seriesStart`'s: COUNT counts from
     * it, and it fills a rule's left-out time parts.
     */
    firstTime?: Temporal.PlainTime | null;
    /**
     * Edited through an occurrence: a rule made all day keeps its times and
     * COUNT for the server to convert.
     */
    viaOccurrence?: boolean;
  }
): string[] {
  const allDay = Boolean(start.date);
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const base = seriesStart?.dateTime ? wallClock(seriesStart, timeZone) : null;
  const newTime = start.dateTime ? wallClock(start, timeZone) : null;
  const startDay = dayOfStart(start, timeZone);
  // The day the rules count their weeks and months from: where the caller
  // moved them to, else the series' start before the edit.
  const baseDay =
    days?.rulesFrom ?? (seriesStart ? dayOfStart(seriesStart, timeZone) : null);
  // The rules' first meeting before the edit, when its day and time are
  // known: they repeat from it.
  const first =
    baseDay && base
      ? baseDay.toZonedDateTime({ plainTime: base, timeZone })
      : null;
  const severalADay = first
    ? meetsSeveralTimesADay({ first, recurrence })
    : rulesDifferInTime(rules);
  const startMoment = seriesStart ? startInstant(seriesStart, timeZone) : null;
  // Made all day, the rule loses its times when the start is the series'
  // own (on the server, or editing the series). Edited through an
  // occurrence, it stays as is so the server can carry a split's COUNT and
  // convert it from the new series' start.
  const convertsRule = allDay && !days?.viaOccurrence;
  const keepAsDate = allDay
    ? allDayDates({
        first: countedFirst({
          anchor: days?.rulesFrom ?? startDay,
          base: days?.firstTime ?? base,
          firstDay: days?.firstDay,
          rules,
          start,
          timeZone,
        }),
        recurrence,
        rules,
        start: startMoment,
        timeZone,
      })
    : null;
  // Whether a skip was on a meeting of the rules (or the start) before the
  // edit. A rule that can't be read may meet there: a skip where nothing
  // meets does nothing, one missed brings a meeting back.
  const readers = first ? rules.map((rule) => readRule({ first, rule })) : [];
  const ownSlot = first
    ? (value: RecurrenceValue) =>
        value.instant !== null &&
        ((startMoment !== null &&
          Temporal.Instant.compare(value.instant, startMoment) === 0) ||
          readers.some(
            (reader) => !reader || reader.meetsAt(value.instant ?? value.day)
          ))
    : null;
  const moveMeetingDay = meetingDayMover({
    rulesFrom: days?.rulesFrom ?? startDay,
    seriesStart,
    start,
    timeZone,
  });
  const untilOf = (line: string) => UNTIL_PART.exec(line)?.[2];
  const ownUntils = days?.before && new Set(days.before.map(untilOf));
  // An UNTIL the edit set was written for the new start's time.
  const newUntil = (line: string) =>
    Boolean(ownUntils && newTime && !ownUntils.has(untilOf(line)));
  const added = addedMoments(recurrence, timeZone);
  const matchRule = (line: string) =>
    matchClock(
      matchUntil(line, {
        allDay,
        base: newUntil(line) ? newTime : base,
        moveDay: moveMeetingDay,
        retimed: Boolean(
          !newUntil(line) &&
            base &&
            newTime &&
            !severalADay &&
            Temporal.PlainTime.compare(base, newTime) !== 0
        ),
        timeZone,
      }),
      start,
      { dropTimes: convertsRule, severalADay, timeZone }
    );
  const cancelsMeeting = staleSkipCancels({
    base,
    before: days?.before ?? [],
    rules: rules.map(matchRule),
    start,
    timeZone,
  });
  let changed = false;
  const next = recurrence.flatMap((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchRule(line)
      : matchDateList(line, start, {
          added,
          cancelsMeeting,
          keepAsDate,
          moveDay: (day) => (rules[0] ? moveMeetingDay(rules[0], day) : day),
          ownSlot,
          seriesZone: timeZone,
          severalADay,
        });
    changed ||= matched !== line;
    // A list whose every value went (onto the new start) goes too.
    return matched ? [matched] : [];
  });
  return changed ? next : recurrence;
}

/** `n` steps (days, months, years) within one period of `period`, signed. */
function withinPeriod(n: number, period: number): number {
  const forward = ((n % period) + period) % period;
  return n >= 0 || forward === 0 ? forward : forward - period;
}

/**
 * How far apart a rule's meetings fall, in days: INTERVAL days, weeks,
 * months or years (a yearly rule in several months meets about monthly).
 */
function periodDays(freq: string, rule: string): number {
  const interval = Number(INTERVAL_PART.exec(rule)?.[1] ?? 1) || 1;
  const months = BY_MONTH_PART.exec(rule)?.[1]?.split(",") ?? [];
  switch (freq) {
    case "DAILY":
      return interval;
    case "WEEKLY":
      return 7 * interval;
    case "MONTHLY":
      return MONTH_DAYS * interval;
    default:
      return months.length === 1 ||
        (months.length === 0 && !BY_MONTH_DAY_PART.test(rule))
        ? YEAR_DAYS * interval
        : MONTH_DAYS;
  }
}

/**
 * Where a monthly or yearly skip lands with the move applied in calendar
 * terms: its months (years, for a rule in one month a year) within
 * INTERVAL, then its leftover days. A move reads two ways, by Temporal
 * ("Mar 1 -> Jan 31 is a month and a day back") or month to month and day
 * to day ("Mar 15 -> Apr 14 is a month on, a day back"). The one with fewer
 * leftover days wins, so February and 30-day moves land right.
 */
function calendarTarget(params: {
  day: Temporal.PlainDate;
  freq: string;
  from: Temporal.PlainDate;
  rule: string;
  to: Temporal.PlainDate;
}): Temporal.PlainDate {
  const { day, freq, from, rule, to } = params;
  const interval = Number(INTERVAL_PART.exec(rule)?.[1] ?? 1) || 1;
  const byYear = freq === "YEARLY" && periodDays(freq, rule) >= YEAR_DAYS;
  const temporal = from.until(to, { largestUnit: byYear ? "years" : "months" });
  const monthToMonth = {
    days: to.day - from.day,
    months: byYear
      ? to.month - from.month
      : (to.year - from.year) * 12 + to.month - from.month,
    years: byYear ? to.year - from.year : 0,
  };
  const move =
    Math.abs(monthToMonth.days) < Math.abs(temporal.days)
      ? monthToMonth
      : { days: temporal.days, months: temporal.months, years: temporal.years };
  // A yearly rule in several months meets about monthly: a month apart.
  const step = freq === "MONTHLY" ? interval : 1;
  // One unit at a time: a move can be a month on and a day back.
  return byYear
    ? day
        .add({ years: withinPeriod(move.years, interval) })
        .add({ months: move.months })
        .add({ days: move.days })
    : day
        .add({ months: withinPeriod(move.months, step) })
        .add({ days: move.days });
}

/** The first day of `day`'s week, by the rule's WKST (Monday by default). */
function weekStart(day: Temporal.PlainDate, rule: string): Temporal.PlainDate {
  const first =
    WEEKDAY_CODES.indexOf(WEEK_START_PART.exec(rule)?.[1] ?? "MO") + 1 || 1;
  return day.subtract({ days: (day.dayOfWeek - first + 7) % 7 });
}

/** Whether a weekly rule (starting `to`) still meets on `day`'s weekday. */
function keepsWeekday(
  rule: string,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean {
  const listed = BY_DAY_PART.exec(rule)?.[1]?.split(",") ?? [];
  const code = WEEKDAY_CODES[day.dayOfWeek - 1] ?? "";
  return listed.length > 0
    ? listed.includes(code)
    : to.dayOfWeek === day.dayOfWeek;
}

/**
 * Where a skip of the old pattern lands in the new one: shifted as the
 * pattern moved, within one period, on the new rule's nearest day (within
 * half a period, the side the move went first on a tie). A skip marks
 * when the person is away, so it stays near that time. Null when the new
 * rule has no day that close: the skip then stays.
 */
function placeInNewPattern(params: {
  day: Temporal.PlainDate;
  from: Temporal.PlainDate;
  newRule: string;
  to: Temporal.PlainDate;
}): Temporal.PlainDate | null {
  const { day, from, newRule, to } = params;
  const freq = FREQ_PART.exec(newRule)?.[1] ?? "";
  const period = periodDays(freq, newRule);
  const meets = (at: Temporal.PlainDate) => isRuleDay(newRule, to, at) === true;
  if (freq === "DAILY" || freq === "WEEKLY") {
    // Weekdays kept (Mon/Tue kept when the start moved onto Tue): only the
    // weeks moved, so the skip keeps its weekday.
    const [was, now] =
      freq === "WEEKLY" && keepsWeekday(newRule, to, day)
        ? [weekStart(from, newRule), weekStart(to, newRule)]
        : [from, to];
    const target = day.add({ days: withinPeriod(was.until(now).days, period) });
    return meets(target) ? target : null;
  }
  const target = calendarTarget({ day, freq, from, rule: newRule, to });
  const sides = (distance: number) =>
    Temporal.PlainDate.compare(to, from) >= 0
      ? [distance, -distance]
      : [-distance, distance];
  for (let distance = 0; distance <= period / 2; distance += 1) {
    for (const offset of sides(distance)) {
      const at = target.add({ days: offset });
      if (meets(at)) {
        return at;
      }
    }
  }
  return null;
}

/**
 * `recurrence` with its skips moved along with a pattern that followed its
 * start from `from` to `to` (Mondays became Tuesdays, the 2nd Tue the 3rd
 * Wed). A skip on or after `from` of a meeting the old rule had, on a day
 * the new rule no longer meets, moves to its place in the new pattern, at
 * its own time, so it stays skipped. Other skips stay. The same array when
 * nothing changes.
 */
export function moveSkippedDays(params: {
  from: Temporal.PlainDate;
  newRule: string;
  /** The rule before the move: only its own days move. */
  oldRule: string;
  /** The series' recurrence, its rule the new one or still the old one. */
  recurrence: string[];
  seriesZone: string;
  to: Temporal.PlainDate;
  /** The series' start time before the move, in its zone; null all day. */
  fromTime?: Temporal.PlainTime | null;
  /** The new start's time in the series' zone; null for an all-day one. */
  toTime?: Temporal.PlainTime | null;
}): string[] {
  const { from, newRule, oldRule, recurrence, seriesZone, to } = params;
  const fromTime = params.fromTime ?? null;
  const toTime = params.toTime ?? null;
  const first = fromTime
    ? from.toZonedDateTime({ plainTime: fromTime, timeZone: seriesZone })
    : from;
  // A meeting of the old rule, before its end: a skip of anything else
  // (another rule's, the second pass of a repeated hour, past the end)
  // skipped nothing it can carry.
  const old = readRule({ first, rule: oldRule });
  const oldMet = (value: RecurrenceValue) =>
    old?.meetsAt(fromTime && value.instant ? value.instant : value.day) ===
    true;
  const placeOf = (day: Temporal.PlainDate): Temporal.PlainDate | null => {
    if (
      Temporal.PlainDate.compare(day, from) < 0 ||
      isRuleDay(newRule, to, day) !== false
    ) {
      return null;
    }
    const place = placeInNewPattern({ day, from, newRule, to });
    // Never land before or on the new start (the meeting just moved there),
    // or on a day the old pattern really met.
    return place &&
      Temporal.PlainDate.compare(place, to) > 0 &&
      isRuleDay(oldRule, from, place) !== true
      ? place
      : null;
  };
  // An added (RDATE) meeting is its own: its skip stays with it, and no
  // skip moves onto one, which would cancel it.
  const added = addedMoments(recurrence, seriesZone);
  const addedDays = addedDates(recurrence, seriesZone);
  const isAdded = (day: Temporal.PlainDate, time: Temporal.PlainTime | null) =>
    time
      ? added.has(
          day.toZonedDateTime({ plainTime: time, timeZone: seriesZone })
            .epochMilliseconds
        )
      : addedDays.has(day.toString());
  const wallTime = (value: RecurrenceValue) =>
    value.instant?.toZonedDateTimeISO(seriesZone).toPlainTime() ?? null;
  const movedSkip = (value: RecurrenceValue) => {
    const time = wallTime(value);
    if (isAdded(value.day, time) || !oldMet(value)) {
      return null;
    }
    const day = placeOf(value.day);
    const movedTime =
      time && toTime && !SUB_DAILY.test(oldRule)
        ? movedClock({ newRule, oldRule, own: time, start: toTime })
        : time;
    return day && !isAdded(day, movedTime) ? { day, time: movedTime } : null;
  };
  // The new start is the day the person picked: never left skipped. A skip
  // at another time that day stays only when it cancels an added meeting;
  // an all-day start takes the whole day.
  const isNewStart = (value: RecurrenceValue) => {
    if (!value.day.equals(to)) {
      return false;
    }
    const time = wallTime(value);
    return (
      !(time && toTime) ||
      Temporal.PlainTime.compare(time, toTime) === 0 ||
      !isAdded(value.day, time)
    );
  };
  // A skip moved onto the new start's own slot would hide the meeting
  // just placed there: it goes instead.
  const landsOnStart = (
    target: { day: Temporal.PlainDate; time: Temporal.PlainTime | null } | null
  ) =>
    Boolean(
      target?.time &&
        toTime &&
        target.day.equals(to) &&
        Temporal.PlainTime.compare(target.time, toTime) === 0
    );
  let changed = false;
  const next = recurrence.flatMap((line) => {
    const list = line.startsWith("EXDATE")
      ? parseDateList(line, seriesZone)
      : null;
    if (!list) {
      return [line];
    }
    const read = list.values.map((value) =>
      readRecurrenceValue(value, list.zone, seriesZone)
    );
    // One line takes one form; a line mixing dates and date-times isn't
    // one this can write back, so it stays as it was.
    if (
      read.some((value) => value?.instant) &&
      read.some((value) => value && !value.instant)
    ) {
      return [line];
    }
    const moved = read.map((value) => (value ? movedSkip(value) : null));
    const dropped = read.map(
      (value, index) =>
        Boolean(value && isNewStart(value)) ||
        landsOnStart(moved[index] ?? null)
    );
    if (moved.every((target) => target === null) && !dropped.some(Boolean)) {
      return [line];
    }
    changed = true;
    const timed = read.some((value) => value?.instant);
    // Timed values are written in UTC: a moment kept exactly, even in the
    // hour a clock change repeats.
    const values = read.flatMap((value, index) => {
      if (dropped[index]) {
        return [];
      }
      const target = moved[index];
      if (!value) {
        return [list.values[index] ?? ""];
      }
      if (!target) {
        return [
          value.instant
            ? compactInstant(value.instant)
            : compactDate(value.day),
        ];
      }
      return [
        target.time
          ? compactInstant(
              target.day
                .toZonedDateTime({
                  plainTime: target.time,
                  timeZone: seriesZone,
                })
                .toInstant()
            )
          : compactDate(target.day),
      ];
    });
    if (values.length === 0) {
      return [];
    }
    const unique = [...new Set(values)].join(",");
    return [
      timed ? `${list.name}:${unique}` : `${list.name};VALUE=DATE:${unique}`,
    ];
  });
  return changed ? next : recurrence;
}
