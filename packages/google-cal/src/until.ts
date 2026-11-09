/**
 * Reading a series' times: its UNTIL and EXDATE/RDATE values, a start's
 * moment, clock and length, and how often its rules meet in a day.
 */
import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";

/** A Google date ("2026-11-16"), as an all-day start writes it. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

const INTERVAL_PART = /INTERVAL=(\d+)/;
const COUNT_VALUE = /[:;]COUNT=(\d+)/;
/** How far a COUNT rule's meetings are walked: fifty years of days. */
const MAX_COUNT_DAYS = 366 * 50;
/** A rule that repeats within a day: its times don't follow the start's. */
const SUB_DAILY = /FREQ=(?:HOURLY|MINUTELY|SECONDLY)/;
const FREQ_PART = /FREQ=([A-Z]+)/;
const BY_MONTH_PART = /BYMONTH=([^;]*)/;
const BY_MONTH_DAY_PART = /BYMONTHDAY=/;
const BY_DAY_PART = /BYDAY=([^;]*)/;
const WEEK_START_PART = /WKST=([A-Z]{2})/;
const TIME_PART = /BY(?:HOUR|MINUTE|SECOND)=/;
/**
 * A time part a rule sets to one value. Google meets a rule once a day, at
 * the start's time, and ignores a list ("BYHOUR=9,15"), so a list reads as
 * left out.
 */
const CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g;

/**
 * A rule's time of day as a key, "9:0:0". A part it leaves out is the
 * start's (`base`), or "*" when that isn't known.
 */
function ruleTime(line: string, base: Temporal.PlainTime | null): string {
  const parts = clockParts(line);
  const fallback = base ? [base.hour, base.minute, base.second] : [];
  return ["BYHOUR", "BYMINUTE", "BYSECOND"]
    .map((name, index) => parts.get(name) ?? fallback[index] ?? "*")
    .join(":");
}

/**
 * Whether `rule` meets at `time`. A part it leaves out is the start's
 * (`base`), or matches any value when that isn't known.
 */
function ruleAtTime(
  rule: string,
  time: Temporal.PlainTime,
  base: Temporal.PlainTime | null
): boolean {
  return Temporal.PlainTime.compare(ruleClock(rule, base ?? time), time) === 0;
}

/** The time parts a rule sets, by name ("BYHOUR" to 9). */
function clockParts(rule: string): Map<string, number> {
  return new Map(
    [...rule.matchAll(CLOCK_PART)].map((match) => [
      match[1] ?? "",
      Number(match[2]),
    ])
  );
}

/** The time of day a rule meets: the parts it sets, the rest `base`'s. */
export function ruleClock(
  rule: string,
  base: Temporal.PlainTime
): Temporal.PlainTime {
  const parts = clockParts(rule);
  return base.with({
    hour: parts.get("BYHOUR") ?? base.hour,
    minute: parts.get("BYMINUTE") ?? base.minute,
    second: parts.get("BYSECOND") ?? base.second,
  });
}

/** A sub-daily rule's steps in a day. */
const STEPS_A_DAY: Record<string, number> = {
  HOURLY: 24,
  MINUTELY: 24 * 60,
  SECONDLY: 24 * 60 * 60,
};

/**
 * Whether a sub-daily rule meets more than once a day: unless it steps
 * whole days at a time (`FREQ=HOURLY;INTERVAL=24`) with no time parts.
 */
function stepsWithinADay(line: string): boolean {
  const steps = STEPS_A_DAY[FREQ_PART.exec(line)?.[1] ?? ""];
  if (!steps) {
    return false;
  }
  const interval = Number(INTERVAL_PART.exec(line)?.[1] ?? "1");
  return interval % steps !== 0 || TIME_PART.test(line);
}

/**
 * Whether `rule` (counted from `start`) has ended before `day`: past its
 * UNTIL day, or its COUNT spent. False when that can't be told.
 */
function endedBefore(
  rule: string,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate,
  timeZone: string
): boolean {
  const until = UNTIL_PART.exec(rule)?.[2];
  const untilDay = until ? untilRuleToDay(until, timeZone) : null;
  if (untilDay) {
    return Temporal.PlainDate.compare(day, untilDay) > 0;
  }
  const count = Number(COUNT_VALUE.exec(rule)?.[1]);
  const last = Number.isFinite(count)
    ? // RFC 5545 also counts the start when it isn't a rule day. Leaving
      // it out can only put the end late, so the rule is taken as still
      // meeting, which each caller treats as the safe way to be wrong.
      countedRuleDays(rule, start, count, { countsStart: false })?.at(-1)
    : undefined;
  return last ? Temporal.PlainDate.compare(day, last) > 0 : false;
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
 * Whether a series meets more than once a day: a sub-daily rule, or rules
 * at different times. With the start's time `base`, the start counts as a
 * meeting and fills the parts a rule leaves out; without it, rules written
 * differently count as different. Such a series' times are its own: they
 * don't follow the start.
 */
export function meetsSeveralTimesADay(
  recurrence: string[],
  base: Temporal.PlainTime | null
): boolean {
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const times = new Set(rules.map((line) => ruleTime(line, base)));
  if (base) {
    times.add(ruleTime("", base));
  }
  return rules.some(stepsWithinADay) || times.size > 1;
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
  const instant = day
    .toZonedDateTime({ plainTime: "23:59:59", timeZone })
    .toInstant();
  return compactInstant(instant);
}

/** The day an UNTIL (or any date / date-time value) falls on in `timeZone`. */
export function untilRuleToDay(
  until: string,
  timeZone: string
): Temporal.PlainDate | null {
  return readRecurrenceValue(until, timeZone, timeZone)?.day ?? null;
}

/**
 * The last moment an UNTIL lets a meeting start: its date-time, or the
 * end of its date (in `timeZone`); null when it doesn't parse.
 */
export function untilMoment(
  until: string,
  timeZone: string
): Temporal.Instant | null {
  const value = readRecurrenceValue(until, timeZone, timeZone);
  if (!value) {
    return null;
  }
  return (
    value.instant ??
    value.day
      .add({ days: 1 })
      .toZonedDateTime({ timeZone })
      .toInstant()
      .subtract({ milliseconds: 1 })
  );
}

function compactDate(day: Temporal.PlainDate): string {
  return day.toString().replace(/-/g, "");
}

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

/** The start's wall-clock time in `timeZone`, midnight when all day. */
function wallClock(start: StartTime, timeZone: string): Temporal.PlainTime {
  return clockOf(start, timeZone) ?? Temporal.PlainTime.from("00:00");
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

/** How `matchDateList` reads and moves a series' EXDATE/RDATE values. */
interface DateListMatch {
  /** The series' added (RDATE) meetings, as epoch milliseconds. */
  added: Set<number>;
  /** Made all day: whether a timed value becomes a date. */
  keepAsDate: ((name: string, value: RecurrenceValue) => boolean) | null;
  /** Whether a skip was on a rule's or the start's meeting before the edit. */
  ownSlot: ((value: RecurrenceValue) => boolean) | null;
  /**
   * Several times a day, with the start's time changed: the times a skip
   * moves to (none drops it). Null otherwise.
   */
  retime:
    | ((
        day: Temporal.PlainDate,
        time: Temporal.PlainTime
      ) => Temporal.PlainTime[])
    | null;
  seriesZone: string;
  /** The rule repeats more than once a day: a skipped time is its own. */
  severalADay: boolean;
}

/**
 * An EXDATE/RDATE line in the start's form: dates for an all-day series;
 * for a timed one, each skip at the start's time on its day, so it stays
 * skipped when that time moves. RDATE times stay as they are.
 */
function matchDateList(
  line: string,
  start: StartTime,
  how: DateListMatch
): string {
  const { added, keepAsDate, ownSlot, retime, seriesZone, severalADay } = how;
  const list = parseDateList(line, seriesZone);
  if (!list) {
    return line;
  }
  const read = list.values.map((value) =>
    readRecurrenceValue(value, list.zone, seriesZone)
  );
  const values = read.filter(
    (value): value is RecurrenceValue => value !== null
  );
  if (values.length < read.length) {
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
  // Times of their own stay theirs: an RDATE's, or any in a rule with
  // several times a day (moving a skipped 15:00 to the start's 9:00 would
  // un-skip it). There, a date stays a date too: it covers the whole day,
  // not one time in it.
  const timed = values.flatMap(({ day, instant }) =>
    instant ? [{ day, instant }] : []
  );
  if (severalADay && timed.length < values.length) {
    return line;
  }
  if (
    (list.name === "RDATE" || severalADay) &&
    timed.length === values.length
  ) {
    return list.name === "EXDATE" && severalADay && retime
      ? retimedList(timed, seriesZone, retime, line)
      : line;
  }
  const time = wallClock(start, seriesZone);
  // A skipped added meeting keeps its time. If a rule's (or the start's)
  // meeting was there too, it's also skipped at the new time, where that
  // meeting moves. A skip never moves onto an added meeting: it would
  // cancel it.
  const moments = values.flatMap((value) => {
    const moment = value.day
      .toZonedDateTime({ plainTime: time, timeZone: seriesZone })
      .toInstant();
    const kept = value.instant;
    // A skip where no rule nor the start met skips nothing: it stays as it
    // is, so it can't land on a meeting. (One a client lined up for the new
    // start can't be told from one that was stale, so it stays too; the
    // server, which knows the series before the save, drops a stale one
    // the series moves onto.)
    if (list.name === "EXDATE" && kept && ownSlot && !ownSlot(value)) {
      return [kept];
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
  if (moments.length === 0) {
    return "";
  }
  // In UTC: a moment kept exactly, even in the hour a clock change repeats.
  return `${list.name}:${[...new Set(moments.map(compactInstant))].join(",")}`;
}

/**
 * The time of day a rule meets, parts it leaves out from the series'
 * time `base`; null when it can't be told (a sub-daily rule, or a part
 * left out with no `base`).
 */
export function ruleTimeOf(
  rule: string,
  base: Temporal.PlainTime | null
): Temporal.PlainTime | null {
  if (SUB_DAILY.test(rule)) {
    return null;
  }
  if (base) {
    return ruleClock(rule, base);
  }
  const parts = clockParts(rule);
  const hour = parts.get("BYHOUR");
  const minute = parts.get("BYMINUTE");
  const second = parts.get("BYSECOND");
  return hour === undefined || minute === undefined || second === undefined
    ? null
    : Temporal.PlainTime.from({ hour, minute, second });
}

/**
 * Whether `time` exists on `day` in `timeZone` (DST can skip it). RFC 5545
 * (3.3.10): a time that doesn't exist that day isn't a meeting and isn't
 * counted. Used where Google can't be asked; where it can, its own list of
 * meetings decides.
 */
export function existsOn(
  day: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string
): boolean {
  return (
    Temporal.PlainTime.compare(
      day.toZonedDateTime({ plainTime: time, timeZone }).toPlainTime(),
      time
    ) === 0
  );
}

/**
 * A COUNT rule's `count` meetings as epoch ms, at `time` on its days,
 * counted from the series' first day `from` at start time `base`, or only
 * those up to `through` when given. Null when its days can't be read or
 * don't all fit in the walk.
 */
export function countedRuleMeetings(params: {
  base: Temporal.PlainTime | null;
  count: number;
  from: Temporal.PlainDate;
  rule: string;
  through?: Temporal.PlainDate;
  time: Temporal.PlainTime;
  timeZone: string;
}): Set<number> | null {
  const { base, count, from, rule, through, time, timeZone } = params;
  const at = (day: Temporal.PlainDate, clock: Temporal.PlainTime) =>
    day.toZonedDateTime({ plainTime: clock, timeZone }).epochMilliseconds;
  const first = base ? at(from, base) : null;
  // The first start is a meeting of a rule at its time, rule day or not
  // (RFC 5545 counts DTSTART; Google does too). A rule at another time
  // (15:00 beside a 9:00 start) doesn't meet then.
  const atStart = base !== null && Temporal.PlainTime.compare(time, base) === 0;
  const meetings = new Set<number>(
    first !== null && atStart && existsOn(from, time, timeZone) ? [first] : []
  );
  if (meetings.size === count) {
    return meetings;
  }
  for (let offset = 0; offset < MAX_COUNT_DAYS; offset += 1) {
    const day = from.add({ days: offset });
    if (through && Temporal.PlainDate.compare(day, through) > 0) {
      return meetings;
    }
    const onRuleDay = isRuleDay(rule, from, day);
    if (onRuleDay === null) {
      return null;
    }
    // A time the clocks skip that day (spring forward) isn't a meeting.
    const moments =
      onRuleDay && existsOn(day, time, timeZone)
        ? [at(day, time)].filter((ms) => !(first && ms < first))
        : [];
    for (const moment of moments) {
      meetings.add(moment);
      if (meetings.size === count) {
        return meetings;
      }
    }
  }
  return null;
}

/**
 * Made all day, which timed RDATE/EXDATE values become dates. A date covers
 * the whole day, so a cancelled added meeting leaves both lists, and a skip
 * becomes a date only when every meeting that day was skipped (the rules',
 * the added ones and the start). Without `base`, a once-a-day series' skip
 * is taken as its meeting's.
 */
function allDayDates(params: {
  /** The day the rules count their days from. */
  anchor: Temporal.PlainDate;
  base: Temporal.PlainTime | null;
  /** The series' first day, where COUNT counts from; null if not known. */
  countFrom: Temporal.PlainDate | null;
  /** The series' start: a meeting whatever its rules and added days say. */
  first: Temporal.Instant | null;
  recurrence: string[];
  rules: string[];
  severalADay: boolean;
  timeZone: string;
}): (name: string, value: RecurrenceValue) => boolean {
  const {
    anchor,
    base,
    countFrom,
    first,
    recurrence,
    rules,
    severalADay,
    timeZone,
  } = params;
  const momentsOf = (name: "EXDATE" | "RDATE") =>
    dateValues(recurrence, name, timeZone).flatMap((value) =>
      value.instant ? [value.instant] : []
    );
  const skipped = new Set(momentsOf("EXDATE").map((m) => m.epochMilliseconds));
  const added = momentsOf("RDATE");
  const at = (day: Temporal.PlainDate, time: Temporal.PlainTime) =>
    day.toZonedDateTime({ plainTime: time, timeZone }).epochMilliseconds;
  const timeOfRule = (rule: string) => ruleTimeOf(rule, base);
  const countedCache = new Map<string, Set<number> | null>();
  const countedMeetings = (
    rule: string,
    time: Temporal.PlainTime,
    count: number,
    from: Temporal.PlainDate
  ) => {
    if (!countedCache.has(rule)) {
      countedCache.set(
        rule,
        countedRuleMeetings({ base, count, from, rule, time, timeZone })
      );
    }
    return countedCache.get(rule) ?? null;
  };
  // One rule's meetings on a day; null when they can't be listed.
  const meetingsOf = (
    rule: string,
    day: Temporal.PlainDate
  ): number[] | null => {
    if (isRuleDay(rule, anchor, day) === false) {
      return [];
    }
    const time = timeOfRule(rule);
    const count = COUNT_VALUE.exec(rule)?.[1];
    // A COUNT counted from a day that isn't the series' first can't say
    // when the rule ends.
    if (!time || (count && !countFrom)) {
      return null;
    }
    // COUNT ends after its last meeting, maybe partway through a day.
    const counted =
      count && countFrom
        ? countedMeetings(rule, time, Number(count), countFrom)
        : undefined;
    if (counted === null) {
      return null;
    }
    // UNTIL ends at a moment: a later time that day doesn't meet.
    const until = UNTIL_PART.exec(rule)?.[2];
    const last = until ? untilMoment(until, timeZone)?.epochMilliseconds : null;
    const ms = at(day, time);
    return existsOn(day, time, timeZone) &&
      !(last && ms > last) &&
      (!counted || counted.has(ms))
      ? [ms]
      : [];
  };
  const ruleMeetings = (day: Temporal.PlainDate): number[] | null => {
    // Before the day the rules count from, they can't say.
    if (Temporal.PlainDate.compare(day, anchor) < 0) {
      return null;
    }
    const meetings: number[] = [];
    for (const rule of rules) {
      const own = meetingsOf(rule, day);
      if (!own) {
        return null;
      }
      meetings.push(...own);
    }
    return meetings;
  };
  // An added meeting that was skipped adds nothing, unless a rule meets
  // then too: that skip is the rule's meeting's.
  const cancelled = new Set(
    added
      .filter((moment) => {
        const ms = moment.epochMilliseconds;
        const day = moment.toZonedDateTimeISO(timeZone).toPlainDate();
        // Rules that can't be listed may meet then: not cancelled. An
        // added day at the series' start is the start's meeting too.
        const listed = ruleMeetings(day);
        return (
          skipped.has(ms) &&
          listed !== null &&
          !listed.includes(ms) &&
          ms !== first?.epochMilliseconds
        );
      })
      .map((moment) => moment.epochMilliseconds)
  );
  return (name, value) => {
    const ms = value.instant?.epochMilliseconds;
    if (ms === undefined || cancelled.has(ms)) {
      return ms === undefined;
    }
    if (name !== "EXDATE") {
      return true;
    }
    const listed = ruleMeetings(value.day);
    if (!listed) {
      // A once-a-day series' time unknown: the skip is its meeting's.
      return !severalADay;
    }
    const meetings = [...listed];
    if (
      first &&
      Temporal.PlainDate.compare(
        first.toZonedDateTimeISO(timeZone).toPlainDate(),
        value.day
      ) === 0 &&
      !meetings.includes(first.epochMilliseconds)
    ) {
      meetings.push(first.epochMilliseconds);
    }
    for (const moment of added) {
      const local = moment.toZonedDateTimeISO(timeZone).toPlainDate();
      if (
        Temporal.PlainDate.compare(local, value.day) === 0 &&
        !cancelled.has(moment.epochMilliseconds)
      ) {
        meetings.push(moment.epochMilliseconds);
      }
    }
    return (
      meetings.length > 0 && meetings.every((meeting) => skipped.has(meeting))
    );
  };
}

/** A series' all-day added (RDATE) days ("2026-11-16"). */
function addedDates(recurrence: string[], seriesZone: string): Set<string> {
  return new Set(
    dateValues(recurrence, "RDATE", seriesZone).flatMap((value) =>
      value.instant ? [] : [value.day.toString()]
    )
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

/**
 * A several-times-a-day series' skipped times (EXDATE), each at its rule's
 * new time, in UTC (one that stays keeps its moment); `line` itself when
 * none moves.
 */
function retimedList(
  values: { day: Temporal.PlainDate; instant: Temporal.Instant }[],
  seriesZone: string,
  retime: (
    day: Temporal.PlainDate,
    time: Temporal.PlainTime
  ) => Temporal.PlainTime[],
  line: string
): string {
  let moved = false;
  const written = values.flatMap((value) => {
    const time = value.instant.toZonedDateTimeISO(seriesZone).toPlainTime();
    const next = retime(value.day, time);
    moved ||= !(
      next.length === 1 &&
      next[0] &&
      Temporal.PlainTime.compare(next[0], time) === 0
    );
    return next.map((at) =>
      compactInstant(
        Temporal.PlainTime.compare(at, time) === 0
          ? value.instant
          : value.day
              .toZonedDateTime({ plainTime: at, timeZone: seriesZone })
              .toInstant()
      )
    );
  });
  if (!moved) {
    return line;
  }
  return written.length > 0 ? `EXDATE:${[...new Set(written)].join(",")}` : "";
}

/**
 * An RRULE with its BYHOUR / BYMINUTE / BYSECOND set to the start's (a
 * "BYHOUR=9" series moved to 10:00 would keep meeting at 9). A series that
 * meets several times a day keeps its own times.
 */
function matchClock(
  line: string,
  start: StartTime,
  how: {
    /** Made all day: drop the rule's times (it has none). */
    dropTimes: boolean;
    severalADay: boolean;
    timeZone: string;
  }
): string {
  const { severalADay, timeZone } = how;
  if (start.date && how.dropTimes && !SUB_DAILY.test(line)) {
    return `RRULE:${line
      .slice("RRULE:".length)
      .split(";")
      .filter((part) => !TIME_PART.test(part))
      .join(";")}`;
  }
  if (!start.dateTime || severalADay) {
    return line;
  }
  const time = wallClock(start, timeZone);
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
    retimed: boolean;
    timeZone: string;
  }
): string {
  const { allDay, base, timeZone } = params;
  const match = UNTIL_PART.exec(line);
  const until = match?.[2];
  const value = until ? readRecurrenceValue(until, timeZone, timeZone) : null;
  if (!(match && value)) {
    return line;
  }
  const timed = value.instant !== null;
  if (timed !== allDay && !(timed && params.retimed)) {
    return line;
  }
  // This rule's own time that day: in a series with rules at several
  // times, not every rule meets at the start's.
  const clock = base ? ruleTimeOf(line, base) : null;
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
  return line.replace(
    UNTIL_PART,
    `${match[1]}UNTIL=${untilRuleForDay(day, allDay, timeZone)}`
  );
}

/** "20261101T063000Z": a moment as a recurrence value, in UTC. */
function compactInstant(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
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
    /** The series' first day (COUNT counts from it); null if not known. */
    firstDay: Temporal.PlainDate | null;
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
  const base = seriesStart?.dateTime ? wallClock(seriesStart, timeZone) : null;
  const severalADay = meetsSeveralTimesADay(recurrence, base);
  const newTime = start.dateTime ? wallClock(start, timeZone) : null;
  const startDay = start.dateTime ? dayOfStart(start, timeZone) : null;
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const baseDay = seriesStart ? dayOfStart(seriesStart, timeZone) : null;
  const added = addedMoments(recurrence, timeZone);
  // The series' start before the edit: a meeting of its own.
  const startMoment = seriesStart ? startInstant(seriesStart, timeZone) : null;
  // Where COUNT counts from. Without `days`, the new start is the series'
  // first (on the server it is).
  let countFrom: Temporal.PlainDate | null = null;
  // Made all day, the rule loses its times when the start is the series'
  // own (on the server, or editing the series). Edited through an
  // occurrence, it stays as is so the server can carry a split's COUNT and
  // convert it from the new series' start.
  const convertsRule = Boolean(start.date) && !days?.viaOccurrence;
  const countBase = days?.firstTime ?? base;
  if (start.date) {
    countFrom = days ? days.firstDay : Temporal.PlainDate.from(start.date);
  }
  const keepAsDate = start.date
    ? allDayDates({
        // Rules count from the new start (the caller moved them and their
        // skips there), unless the caller says they didn't move.
        anchor: days?.rulesFrom ?? Temporal.PlainDate.from(start.date),
        base: countBase,
        countFrom,
        first: startMoment,
        recurrence,
        rules,
        severalADay,
        timeZone,
      })
    : null;
  const isAdded = (day: Temporal.PlainDate, time: Temporal.PlainTime) =>
    added.has(
      day.toZonedDateTime({ plainTime: time, timeZone }).epochMilliseconds
    );
  const retime =
    severalADay &&
    base &&
    baseDay &&
    newTime &&
    startDay &&
    Temporal.PlainTime.compare(base, newTime) !== 0
      ? (day: Temporal.PlainDate, time: Temporal.PlainTime) => {
          // The rules that met at this skip move it with them, each by the
          // time parts it leaves out (one that sets them all stays).
          const owners = rules.filter(
            (rule) =>
              isRuleDay(rule, baseDay, day) !== false &&
              !endedBefore(rule, baseDay, day, timeZone) &&
              ruleAtTime(rule, time, base)
          );
          // A skipped added meeting is its own: it stays.
          if (owners.length === 0 || isAdded(day, time)) {
            return [time];
          }
          // Another rule's meeting at `at`: any rule but an owner that
          // moves there itself (a fixed owner that meets at `at` counts).
          const meetsThen = (at: Temporal.PlainTime) =>
            rules.some(
              (rule) =>
                !(
                  owners.includes(rule) &&
                  Temporal.PlainTime.compare(
                    withRuleClock(rule, time, newTime),
                    at
                  ) === 0
                ) &&
                isRuleDay(rule, startDay, day) !== false &&
                !endedBefore(rule, startDay, day, timeZone) &&
                ruleAtTime(rule, at, newTime)
            );
          return owners.flatMap((rule) => {
            const next = SUB_DAILY.test(rule)
              ? time
              : withRuleClock(rule, time, newTime);
            // Onto the start's own slot: that meeting was just placed, so
            // the skip goes. Onto another rule's meeting: it stays put.
            if (
              Temporal.PlainDate.compare(day, startDay) === 0 &&
              Temporal.PlainTime.compare(next, newTime) === 0
            ) {
              return [];
            }
            return meetsThen(next) || isAdded(day, next) ? [time] : [next];
          });
        }
      : null;
  const ownSlot =
    base && baseDay
      ? (value: RecurrenceValue) => {
          const at = value.instant;
          if (!at) {
            return false;
          }
          if (startMoment && Temporal.Instant.compare(at, startMoment) === 0) {
            return true;
          }
          const clock = at.toZonedDateTimeISO(timeZone).toPlainTime();
          // A skip at the second pass of a repeated hour is another
          // meeting's.
          if (!atOwnWallTime(at, timeZone)) {
            return false;
          }
          // A day a rule can't be read for may be its: a skip where
          // nothing meets does nothing, one missed brings a meeting back.
          return rules.some(
            (rule) =>
              isRuleDay(rule, baseDay, value.day) !== false &&
              !endedBefore(rule, baseDay, value.day, timeZone) &&
              ruleAtTime(rule, clock, base)
          );
        }
      : null;
  let changed = false;
  const next = recurrence.flatMap((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchClock(
          matchUntil(line, {
            allDay,
            base,
            retimed: Boolean(
              base &&
                newTime &&
                !severalADay &&
                Temporal.PlainTime.compare(base, newTime) !== 0
            ),
            timeZone,
          }),
          start,
          { dropTimes: convertsRule, severalADay, timeZone }
        )
      : matchDateList(line, start, {
          added,
          keepAsDate,
          ownSlot,
          retime,
          seriesZone: timeZone,
          severalADay,
        });
    changed ||= matched !== line;
    // A list whose every value went (onto the new start) goes too.
    return matched ? [matched] : [];
  });
  return changed ? next : recurrence;
}

/**
 * The move's shift within one repeat period (`period` days), in its
 * direction: Fri -> Mon is +3 days, Mon -> the next week's Wed +2, and
 * Mon -> the Sunday before -1. Every occurrence moves by it.
 */
function shiftWithinPeriod(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  period: number
): number {
  return withinPeriod(from.until(to).days, period);
}

/** `n` steps (days, months, years) within one period of `period`, signed. */
function withinPeriod(n: number, period: number): number {
  const forward = ((n % period) + period) % period;
  return n >= 0 || forward === 0 ? forward : forward - period;
}

/**
 * Where a monthly or yearly skip lands with the move applied in calendar
 * terms: its months (years, for a rule in one month a year) within
 * INTERVAL, then its leftover days. A move reads two ways, by Temporal
 * ("Mar 1 -> Jan 31 is a month and a day back") or month to month and day
 * to day ("Mar 15 -> Apr 14 is a month on, a day back"). The one with fewer
 * leftover days wins, so February and 30-day moves land right.
 */
function calendarTarget(
  freq: string,
  rule: string,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): Temporal.PlainDate {
  const interval = Number(INTERVAL_PART.exec(rule)?.[1] ?? 1) || 1;
  const byYear = freq === "YEARLY" && periodDays(freq, rule) >= YEAR_DAYS;
  const temporal = from.until(to, { largestUnit: byYear ? "years" : "months" });
  const monthToMonth = byYear
    ? {
        days: to.day - from.day,
        months: to.month - from.month,
        years: to.year - from.year,
      }
    : {
        days: to.day - from.day,
        months: (to.year - from.year) * 12 + to.month - from.month,
        years: 0,
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

/** Days in a month and a year, near enough to place a skip within one. */
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

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
 * The new rule's day nearest `target`, within half a period, the side
 * the move went first on a tie; null when none is that close.
 */
function nearestRuleDay(
  newRule: string,
  to: Temporal.PlainDate,
  target: Temporal.PlainDate,
  period: number,
  forward: boolean
): Temporal.PlainDate | null {
  for (let distance = 0; distance <= period / 2; distance += 1) {
    const sides = forward ? [distance, -distance] : [-distance, distance];
    for (const offset of sides) {
      const day = target.add({ days: offset });
      if (isRuleDay(newRule, to, day) === true) {
        return day;
      }
    }
  }
  return null;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

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
  const days = BY_DAY_PART.exec(rule)?.[1]?.split(",") ?? [];
  const code = WEEKDAY_CODES[day.dayOfWeek - 1] ?? "";
  return days.length > 0 ? days.includes(code) : to.dayOfWeek === day.dayOfWeek;
}

/**
 * Where a skip of the old pattern lands in the new one: shifted as the
 * pattern moved, within one period, on the new rule's nearest day. A skip
 * marks when the person is away, so it stays near that time. Null when the
 * new rule has no day within half a period: the skip then stays.
 */
function placeInNewPattern(
  freq: string,
  newRule: string,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  day: Temporal.PlainDate
): Temporal.PlainDate | null {
  const period = periodDays(freq, newRule);
  if (freq === "DAILY" || freq === "WEEKLY") {
    const shift =
      freq === "WEEKLY" && keepsWeekday(newRule, to, day)
        ? // The days stayed (Mon/Tue kept when the start moved onto Tue):
          // only the weeks moved, so the skip keeps its weekday.
          shiftWithinPeriod(
            weekStart(from, newRule),
            weekStart(to, newRule),
            period
          )
        : shiftWithinPeriod(from, to, period);
    const target = day.add({ days: shift });
    return isRuleDay(newRule, to, target) === true ? target : null;
  }
  return nearestRuleDay(
    newRule,
    to,
    calendarTarget(freq, newRule, from, to, day),
    period,
    Temporal.PlainDate.compare(to, from) >= 0
  );
}

/**
 * `recurrence` with its skips moved along with a pattern that followed its
 * start from `from` to `to` (Mondays became Tuesdays, the 2nd Tue the 3rd
 * Wed). A skip on or after `from` that the new rule no longer meets moves
 * to its place in the new pattern, at its own time, so it stays skipped.
 * Other skips stay. The same array when nothing changes.
 */
export function moveSkippedDays(params: {
  from: Temporal.PlainDate;
  newRule: string;
  /** The rule before the move: only its own days move. */
  oldRule: string;
  recurrence: string[];
  seriesZone: string;
  to: Temporal.PlainDate;
  /** The series' start time before the move, in its zone; null all day. */
  fromTime?: Temporal.PlainTime | null;
  /** The new start's time in the series' zone; null for an all-day one. */
  toTime?: Temporal.PlainTime | null;
}): string[] {
  const { from, newRule, oldRule, recurrence, seriesZone, to, toTime } = params;
  const fromTime = params.fromTime ?? null;
  const freq = FREQ_PART.exec(newRule)?.[1] ?? "";
  const placeOf = (day: Temporal.PlainDate): Temporal.PlainDate | null => {
    if (Temporal.PlainDate.compare(day, from) < 0) {
      return null;
    }
    // Only a skip of the old pattern's meeting that the new one lacks moves.
    if (
      isRuleDay(oldRule, from, day) !== true ||
      isRuleDay(newRule, to, day) !== false
    ) {
      return null;
    }
    const place = placeInNewPattern(freq, newRule, from, to, day);
    // Never land before or on the new start (the meeting just moved there),
    // or on a day the old pattern really met.
    return place &&
      Temporal.PlainDate.compare(place, to) > 0 &&
      isRuleDay(oldRule, from, place) !== true
      ? place
      : null;
  };
  const severalADay = meetsSeveralTimesADay(recurrence, fromTime);
  // A timed skip moves only if the moved rule meets then: another rule's
  // (a 15:00 rule left on Mondays) stays with it, as does one where
  // nothing met (it would cancel a meeting where it lands), such as the
  // second pass of a repeated hour.
  const ownSkip = (value: RecurrenceValue) =>
    !(value.instant && (severalADay || fromTime)) ||
    (atOwnWallTime(value.instant, seriesZone) &&
      ruleAtTime(
        oldRule,
        value.instant.toZonedDateTimeISO(seriesZone).toPlainTime(),
        fromTime
      ));
  const wallTime = (value: RecurrenceValue) =>
    value.instant?.toZonedDateTimeISO(seriesZone).toPlainTime() ?? null;
  // A skip another rule still needs stays, and no skip lands on another
  // rule's meeting. A rule that can't be read counts as meeting.
  const otherRules = recurrence.filter(
    (line) => line.startsWith("RRULE:") && line !== newRule
  );
  const othersMeet = (
    day: Temporal.PlainDate,
    time: Temporal.PlainTime | null,
    start: Temporal.PlainDate,
    base: Temporal.PlainTime | null
  ) =>
    otherRules.some(
      (rule) =>
        isRuleDay(rule, start, day) !== false &&
        !endedBefore(rule, start, day, seriesZone) &&
        (!time || ruleAtTime(rule, time, base))
    );
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
  const movedSkip = (value: RecurrenceValue) => {
    const time = wallTime(value);
    if (
      !ownSkip(value) ||
      isAdded(value.day, time) ||
      othersMeet(value.day, time, from, fromTime)
    ) {
      return null;
    }
    const day = placeOf(value.day);
    const movedTime =
      time && toTime && !SUB_DAILY.test(oldRule)
        ? withRuleClock(oldRule, time, toTime)
        : time;
    return day &&
      !isAdded(day, movedTime) &&
      !othersMeet(day, movedTime, to, toTime ?? null)
      ? { day, time: movedTime }
      : null;
  };
  // Several times a day, a skip of the moved rule that stays on its day
  // still moves to the rule's new time.
  const retimedSkip = (value: RecurrenceValue) => {
    const time = wallTime(value);
    if (
      !(severalADay && time && toTime && ownSkip(value)) ||
      SUB_DAILY.test(oldRule) ||
      // The moved rule must have met that day: another rule's day isn't its.
      isRuleDay(oldRule, from, value.day) === false ||
      isAdded(value.day, time) ||
      othersMeet(value.day, time, from, fromTime)
    ) {
      return null;
    }
    const retimed = withRuleClock(oldRule, time, toTime);
    return Temporal.PlainTime.compare(retimed, time) === 0 ||
      isAdded(value.day, retimed) ||
      othersMeet(value.day, retimed, to, toTime)
      ? null
      : { day: value.day, time: retimed };
  };
  // A skip moved or retimed onto the new start's own slot would hide the
  // meeting just placed there: it goes instead.
  const landsOnStart = (
    target: { day: Temporal.PlainDate; time: Temporal.PlainTime | null } | null
  ) =>
    Boolean(
      target?.time &&
        toTime &&
        Temporal.PlainDate.compare(target.day, to) === 0 &&
        Temporal.PlainTime.compare(target.time, toTime) === 0
    );
  const isNewStart = (value: RecurrenceValue | null) => {
    if (!value || Temporal.PlainDate.compare(value.day, to) !== 0) {
      return false;
    }
    const time = wallTime(value);
    // The new start is the day the person picked: never left skipped. A
    // skip at another time that day stays when the series meets several
    // times a day, or when it cancels an added meeting. An all-day start
    // takes the whole day: every skip on it goes.
    return (
      !(time && toTime) ||
      Temporal.PlainTime.compare(time, toTime) === 0 ||
      !(severalADay || isAdded(value.day, time))
    );
  };
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
    const moved = read.map((value) =>
      value ? (movedSkip(value) ?? retimedSkip(value)) : null
    );
    const dropped = read.map(
      (value, index) => isNewStart(value) || landsOnStart(moved[index] ?? null)
    );
    if (moved.every((day) => day === null) && !dropped.some(Boolean)) {
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
      if (!(value && (target?.day ?? value.day))) {
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
    return [
      timed
        ? `${list.name}:${[...new Set(values)].join(",")}`
        : `${list.name};VALUE=DATE:${[...new Set(values)].join(",")}`,
    ];
  });
  return changed ? next : recurrence;
}

/**
 * Whether `instant` is the moment its wall-clock time in `timeZone` names:
 * not the second pass of an hour a clock change repeats, where a rule
 * doesn't meet (RFC 5545 reads a repeated time as its first).
 */
export function atOwnWallTime(
  instant: Temporal.Instant,
  timeZone: string
): boolean {
  const named = instant
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toZonedDateTime(timeZone)
    .toInstant();
  return Temporal.Instant.compare(named, instant) === 0;
}
