/**
 * A series' UNTIL and its EXDATE/RDATE lines: an UNTIL written so the end
 * day's occurrence is included, read back as a day, and every value kept
 * in the form Google requires (dates for an all-day series, date-times for
 * a timed one). Shared by the server and both apps.
 */
import { Temporal } from "temporal-polyfill";
import { countedRuleDays, isRuleDay } from "./rule-days";

const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
const SEVERAL_A_DAY =
  /(?:[:;])(?:FREQ=(?:HOURLY|MINUTELY|SECONDLY)|BY(?:HOUR|MINUTE|SECOND)=[^;]*,)/;

const INTERVAL_PART = /INTERVAL=(\d+)/;
const COUNT_VALUE = /[:;]COUNT=(\d+)/;
const COUNT_SWAP = /([:;])COUNT=\d+/;
/** How far a COUNT rule's meetings are walked: fifty years of days. */
const MAX_COUNT_DAYS = 366 * 50;
const CLOCK_PART_NAME = /^BY(?:HOUR|MINUTE|SECOND)=/;
/** A rule that repeats within a day: its times don't follow the start's. */
const SUB_DAILY = /FREQ=(?:HOURLY|MINUTELY|SECONDLY)/;
const FREQ_PART = /FREQ=([A-Z]+)/;
const BY_MONTH_PART = /BYMONTH=([^;]*)/;
const BY_MONTH_DAY_PART = /BYMONTHDAY=/;
const BY_DAY_PART = /BYDAY=([^;]*)/;
const WEEK_START_PART = /WKST=([A-Z]{2})/;
const CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=([^;]*)/g;

/**
 * The time of day a rule meets, "9:0:0": its BYHOUR / BYMINUTE / BYSECOND,
 * a part it leaves out the series' start's (`base`), or "*" when that
 * isn't known.
 */
function ruleTime(line: string, base: Temporal.PlainTime | null): string {
  const parts = new Map(
    [...line.matchAll(CLOCK_PART)].map((match) => [match[1], Number(match[2])])
  );
  const fallback = base ? [base.hour, base.minute, base.second] : [];
  return ["BYHOUR", "BYMINUTE", "BYSECOND"]
    .map((name, index) => parts.get(name) ?? fallback[index] ?? "*")
    .join(":");
}

/**
 * Whether `rule` meets at `time`: each of its BYHOUR / BYMINUTE / BYSECOND
 * lists has that part, and a part it leaves out is the series' start's
 * (`base`), any when that isn't known.
 */
function ruleMeetsAt(
  rule: string,
  time: Temporal.PlainTime,
  base: Temporal.PlainTime | null
): boolean {
  const parts = new Map(
    [...rule.matchAll(CLOCK_PART)].map((match) => [
      match[1],
      (match[2] ?? "").split(",").map(Number),
    ])
  );
  const actual = [time.hour, time.minute, time.second];
  const fallback = base ? [base.hour, base.minute, base.second] : null;
  return ["BYHOUR", "BYMINUTE", "BYSECOND"].every((name, index) => {
    const values = parts.get(name);
    if (values) {
      return values.includes(actual[index] ?? -1);
    }
    return !fallback || fallback[index] === actual[index];
  });
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
    ? // Not counting the start as one of its own (RFC 5545 does when it
      // isn't a rule day) can only put the end a position late: a skip
      // is then kept where it is, the safe way to be wrong.
      countedRuleDays(rule, start, count, false)?.at(-1)
    : undefined;
  return last ? Temporal.PlainDate.compare(day, last) > 0 : false;
}

/**
 * `own`'s parts that `rule` sets (its BYHOUR, BYMINUTE, BYSECOND), the
 * rest `start`'s: where a rule's meeting moves when the start does.
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
 * Whether a series meets more than once a day: a rule with several times
 * (BYHOUR=9,15) or a sub-daily frequency, or rules at different times
 * (one at 9:00, another at 15:00). Its times are then its own: they
 * aren't lined up with the start, and a skipped time stays that time.
 * With the series' start time (`base`), a part a rule leaves out is that
 * time's ("BYHOUR=9" and "BYHOUR=9;BYMINUTE=0" are one time for a 9:00
 * series); without it, rules written differently count as different.
 */
export function meetsSeveralTimesADay(
  recurrence: string[],
  base: Temporal.PlainTime | null = null
): boolean {
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  return (
    rules.some((line) => SEVERAL_A_DAY.test(line)) ||
    new Set(rules.map((line) => ruleTime(line, base))).size > 1
  );
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
  return `${instant.toString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** The day an UNTIL (or any date / date-time value) falls on in `timeZone`. */
export function untilRuleToDay(
  until: string,
  timeZone: string
): Temporal.PlainDate | null {
  const cleaned = until.replace(/[-:]/g, "");
  const dateOnly = UNTIL_DATE.exec(cleaned);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return Temporal.PlainDate.from(`${y}-${m}-${d}`);
  }
  const full = UNTIL_DATE_TIME.exec(cleaned);
  if (!full) {
    return null;
  }
  const [, y, m, d, hh, mm, ss, offset] = full;
  try {
    // No offset: a local time in `timeZone` (a TZID value).
    if (!offset) {
      return Temporal.PlainDate.from(`${y}-${m}-${d}`);
    }
    const zone =
      offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    return Temporal.Instant.from(`${y}-${m}-${d}T${hh}:${mm}:${ss}${zone}`)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

/**
 * The last moment an UNTIL lets a meeting start: its date-time, or the
 * end of its date (in `timeZone`); null when it doesn't parse.
 */
function untilMoment(until: string, timeZone: string): Temporal.Instant | null {
  const cleaned = until.replace(/[-:]/g, "");
  const full = UNTIL_DATE_TIME.exec(cleaned);
  try {
    if (!full) {
      const day = untilRuleToDay(until, timeZone);
      return day
        ? day
            .add({ days: 1 })
            .toZonedDateTime({ timeZone })
            .toInstant()
            .subtract({ milliseconds: 1 })
        : null;
    }
    const [, y, m, d, hh, mm, ss, offset] = full;
    const local = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
    if (!offset) {
      return Temporal.PlainDateTime.from(local)
        .toZonedDateTime(timeZone)
        .toInstant();
    }
    const zone =
      offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    return Temporal.Instant.from(`${local}${zone}`);
  } catch {
    return null;
  }
}

/** "093000" for 9:30. */
function compactTime(time: Temporal.PlainTime): string {
  return time.toString({ smallestUnit: "second" }).replace(/:/g, "");
}

function compactDate(day: Temporal.PlainDate): string {
  return day.toString().replace(/-/g, "");
}

/** A start as Google writes it: a date (all day) or a date-time. */
interface StartTime {
  date?: string | null;
  dateTime?: string | null;
}

/**
 * The local day a Google start falls on in `timeZone` (an all-day one's
 * date); null when it has neither or doesn't parse.
 */
export function dayOfStart(
  start: StartTime,
  timeZone: string
): Temporal.PlainDate | null {
  try {
    if (start.date) {
      return Temporal.PlainDate.from(start.date);
    }
    return start.dateTime
      ? Temporal.Instant.from(start.dateTime)
          .toZonedDateTimeISO(timeZone)
          .toPlainDate()
      : null;
  } catch {
    return null;
  }
}

/** The start's wall-clock time in `timeZone` ("09:00"), for a timed one. */
function wallClock(start: StartTime, timeZone: string): Temporal.PlainTime {
  try {
    return start.dateTime
      ? Temporal.Instant.from(start.dateTime)
          .toZonedDateTimeISO(timeZone)
          .toPlainTime()
      : Temporal.PlainTime.from("00:00");
  } catch {
    return Temporal.PlainTime.from("00:00");
  }
}

/** A recurrence value read: its day in the series' zone, its moment if timed. */
export interface RecurrenceValue {
  day: Temporal.PlainDate;
  instant: Temporal.Instant | null;
}

/**
 * Reads "20261128", "20261128T140000Z", or "20261128T090000" (a local time
 * in `valueZone`, its line's TZID) as the day it falls on in `seriesZone`:
 * a Tokyo series' Monday skipped as "Sunday 19:00 New York" is Monday.
 */
export function readRecurrenceValue(
  value: string,
  valueZone: string,
  seriesZone: string
): RecurrenceValue | null {
  // A Google date-time ("2026-11-01T09:00:00-05:00"): read as is, since
  // stripping its dashes would strip an offset's minus sign too.
  if (ISO_DATE_TIME.test(value)) {
    try {
      const instant = Temporal.Instant.from(value);
      return {
        day: instant.toZonedDateTimeISO(seriesZone).toPlainDate(),
        instant,
      };
    } catch {
      return null;
    }
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
  try {
    let instant: Temporal.Instant;
    if (offset) {
      const zone =
        offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
      instant = Temporal.Instant.from(`${local}${zone}`);
    } else {
      instant = Temporal.PlainDateTime.from(local)
        .toZonedDateTime(valueZone)
        .toInstant();
    }
    return {
      day: instant.toZonedDateTimeISO(seriesZone).toPlainDate(),
      instant,
    };
  } catch {
    return null;
  }
}

/** An EXDATE/RDATE line: its name, the zone its values are in, and them. */
export function parseDateList(
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
 * An EXDATE/RDATE line in the start's form, counted on the series' days:
 * dates for an all-day series; for a timed one, a skipped occurrence at
 * the series' (possibly new) start time on its day, so it stays skipped
 * when the series' time moves. An RDATE's own times stay its own.
 */
function matchDateList(
  line: string,
  start: StartTime,
  seriesZone: string,
  /** The rule repeats more than once a day: a skipped time is its own. */
  severalADay: boolean,
  /**
   * In such a series, where a skipped time on a day goes when the start's
   * time changes (its rules' new times; none drops it); null when the time
   * doesn't change.
   */
  retime:
    | ((
        day: Temporal.PlainDate,
        time: Temporal.PlainTime
      ) => Temporal.PlainTime[])
    | null = null,
  /** The series' added (RDATE) meetings, as epoch milliseconds. */
  added: Set<number> = new Set(),
  /** Turning the series all day: whether a timed value becomes a date. */
  keepAsDate: ((name: string, value: RecurrenceValue) => boolean) | null = null
): string {
  const list = parseDateList(line, seriesZone);
  if (!list) {
    return line;
  }
  const read = list.values.map((value) =>
    readRecurrenceValue(value, list.zone, seriesZone)
  );
  if (read.some((value) => value === null)) {
    return line;
  }
  const values = read as RecurrenceValue[];
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
  // un-skip it).
  if (
    (list.name === "RDATE" || severalADay) &&
    values.every((value) => value.instant)
  ) {
    return list.name === "EXDATE" && severalADay && retime
      ? retimedList(list.name, values, seriesZone, retime, line)
      : line;
  }
  const time = wallClock(start, seriesZone);
  // A skipped added meeting is that meeting's: it keeps its time. And a
  // skip never moves onto an added meeting, which it would cancel.
  const moments = values.map((value) => {
    const moment = value.day
      .toZonedDateTime({ plainTime: time, timeZone: seriesZone })
      .toInstant();
    const keep =
      list.name === "EXDATE" &&
      value.instant &&
      (added.has(value.instant.epochMilliseconds) ||
        added.has(moment.epochMilliseconds));
    return keep ? (value.instant as Temporal.Instant) : moment;
  });
  const same = moments.every(
    (moment, index) =>
      values[index]?.instant &&
      Temporal.Instant.compare(
        moment,
        values[index].instant as Temporal.Instant
      ) === 0
  );
  if (same) {
    return line;
  }
  return `${list.name};TZID=${seriesZone}:${[
    ...new Set(
      moments.map((moment) => {
        const local = moment.toZonedDateTimeISO(seriesZone);
        return `${compactDate(local.toPlainDate())}T${compactTime(local.toPlainTime())}`;
      })
    ),
  ].join(",")}`;
}

/**
 * The times of day a rule meets, parts it leaves out from the series'
 * time `base`; null when they can't be listed (a sub-daily rule, or a
 * part left out with no `base`).
 */
function ruleTimesOf(
  rule: string,
  base: Temporal.PlainTime | null
): Temporal.PlainTime[] | null {
  if (SUB_DAILY.test(rule)) {
    return null;
  }
  const parts = new Map(
    [...rule.matchAll(CLOCK_PART)].map((match) => [
      match[1],
      (match[2] ?? "").split(",").map(Number),
    ])
  );
  const fill = (name: string, own: number | undefined) =>
    parts.get(name) ?? (own === undefined ? null : [own]);
  const hours = fill("BYHOUR", base?.hour);
  const minutes = fill("BYMINUTE", base?.minute);
  const seconds = fill("BYSECOND", base?.second);
  if (!(hours && minutes && seconds)) {
    return null;
  }
  return hours.flatMap((hour) =>
    minutes.flatMap((minute) =>
      seconds.map((second) => Temporal.PlainTime.from({ hour, minute, second }))
    )
  );
}

/**
 * An all-day rule made from one that met several times a day keeps its
 * length in days: its COUNT becomes the days its counted meetings fell on
 * (9:00 and 15:00 five times is three days). The line as is when it can't
 * be counted.
 */
function countInDays(
  line: string,
  base: Temporal.PlainTime | null,
  from: Temporal.PlainDate | null,
  timeZone: string
): string {
  const count = Number(COUNT_VALUE.exec(line)?.[1]);
  const times = ruleTimesOf(line, base);
  if (!(from && Number.isFinite(count) && times && times.length > 1)) {
    return line;
  }
  const meetings = countedRuleMeetings({
    base,
    count,
    from,
    rule: line,
    times,
    timeZone,
  });
  if (!meetings) {
    return line;
  }
  const days = new Set(
    [...meetings].map((ms) =>
      Temporal.Instant.fromEpochMilliseconds(ms)
        .toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toString()
    )
  );
  return line.replace(COUNT_SWAP, `$1COUNT=${days.size}`);
}

/** Whether `time` is on the clock on `day` in `timeZone` (not skipped by DST). */
function existsOn(
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
 * A COUNT rule's meetings as moments, every time of every day counted in
 * order from the series' first day `from` (from its start time `base`
 * that day), up to `count`; null when its days can't be read.
 */
function countedRuleMeetings(params: {
  base: Temporal.PlainTime | null;
  count: number;
  from: Temporal.PlainDate;
  rule: string;
  times: Temporal.PlainTime[];
  timeZone: string;
}): Set<number> | null {
  const { base, count, from, rule, timeZone } = params;
  const times = [...params.times].sort(Temporal.PlainTime.compare);
  const at = (day: Temporal.PlainDate, time: Temporal.PlainTime) =>
    day.toZonedDateTime({ plainTime: time, timeZone }).epochMilliseconds;
  const first = base ? at(from, base) : null;
  const meetings = new Set<number>();
  for (let offset = 0; offset < MAX_COUNT_DAYS; offset += 1) {
    const day = from.add({ days: offset });
    const onRuleDay = isRuleDay(rule, from, day);
    if (onRuleDay === null) {
      return null;
    }
    // A time the clocks skip that day (spring forward) isn't a meeting.
    const moments = onRuleDay
      ? times
          .filter((time) => existsOn(day, time, timeZone))
          .map((time) => at(day, time))
          .filter((ms) => !(first && ms < first))
      : [];
    for (const moment of moments) {
      meetings.add(moment);
      if (meetings.size === count) {
        return meetings;
      }
    }
  }
  return meetings;
}

/**
 * Turning a timed series all day, which of its timed added (RDATE) and
 * skipped (EXDATE) values become dates. A date skips or adds the whole
 * day, so: an added meeting that was cancelled goes from both lists; a
 * skip becomes its date only when every meeting that day (the rules'
 * times, from the series' time `base` for parts they leave out, and the
 * added ones) was skipped, so one skipped time never erases a day that
 * still met. Without `base`, a once-a-day series' skip is taken as its
 * meeting's.
 */
function allDayDates(params: {
  /** The day the rules count their days from. */
  anchor: Temporal.PlainDate;
  base: Temporal.PlainTime | null;
  /** The series' first day, where COUNT counts from; null if not known. */
  countFrom: Temporal.PlainDate | null;
  recurrence: string[];
  rules: string[];
  severalADay: boolean;
  timeZone: string;
}): (name: string, value: RecurrenceValue) => boolean {
  const { anchor, base, countFrom, recurrence, rules, severalADay, timeZone } =
    params;
  const momentsOf = (name: string) => {
    const moments: Temporal.Instant[] = [];
    for (const line of recurrence) {
      const list = line.startsWith(name) ? parseDateList(line, timeZone) : null;
      for (const value of list?.values ?? []) {
        const read = list && readRecurrenceValue(value, list.zone, timeZone);
        if (read?.instant) {
          moments.push(read.instant);
        }
      }
    }
    return moments;
  };
  const skipped = new Set(momentsOf("EXDATE").map((m) => m.epochMilliseconds));
  const added = momentsOf("RDATE");
  const at = (day: Temporal.PlainDate, time: Temporal.PlainTime) =>
    day.toZonedDateTime({ plainTime: time, timeZone }).epochMilliseconds;
  // The times a rule meets on a day, or null when they can't be listed.
  const ruleTimes = (rule: string) => ruleTimesOf(rule, base);
  const countedCache = new Map<string, Set<number> | null>();
  const countedMeetings = (
    rule: string,
    times: Temporal.PlainTime[],
    count: number,
    from: Temporal.PlainDate
  ) => {
    if (!countedCache.has(rule)) {
      countedCache.set(
        rule,
        countedRuleMeetings({ base, count, from, rule, times, timeZone })
      );
    }
    return countedCache.get(rule) ?? null;
  };
  // One rule's meetings on a day, as moments; null when they can't be listed.
  const meetingsOf = (
    rule: string,
    day: Temporal.PlainDate
  ): number[] | null => {
    if (isRuleDay(rule, anchor, day) === false) {
      return [];
    }
    const times = ruleTimes(rule);
    const count = COUNT_VALUE.exec(rule)?.[1];
    // A COUNT counted from a day that isn't the series' first can't say
    // when the rule ends.
    if (!times || (count && !countFrom)) {
      return null;
    }
    // COUNT ends after its last meeting, maybe partway through a day.
    const counted =
      count && countFrom
        ? countedMeetings(rule, times, Number(count), countFrom)
        : undefined;
    if (counted === null) {
      return null;
    }
    // UNTIL ends at a moment: a later time that day doesn't meet.
    const until = UNTIL_PART.exec(rule)?.[2];
    const last = until ? untilMoment(until, timeZone)?.epochMilliseconds : null;
    return times
      .filter((time) => existsOn(day, time, timeZone))
      .map((time) => at(day, time))
      .filter((ms) => !(last && ms > last) && (!counted || counted.has(ms)));
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
        // Rules that can't be listed may meet then: not cancelled.
        const listed = ruleMeetings(day);
        return skipped.has(ms) && listed !== null && !listed.includes(ms);
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
  const days = new Set<string>();
  for (const line of recurrence) {
    const list = line.startsWith("RDATE")
      ? parseDateList(line, seriesZone)
      : null;
    for (const value of list?.values ?? []) {
      const read = list && readRecurrenceValue(value, list.zone, seriesZone);
      if (read && !read.instant) {
        days.add(read.day.toString());
      }
    }
  }
  return days;
}

/** A series' added (RDATE) meetings with a time, as epoch milliseconds. */
function addedMoments(recurrence: string[], seriesZone: string): Set<number> {
  const moments = new Set<number>();
  for (const line of recurrence) {
    const list = line.startsWith("RDATE")
      ? parseDateList(line, seriesZone)
      : null;
    for (const value of list?.values ?? []) {
      const read = list && readRecurrenceValue(value, list.zone, seriesZone);
      if (read?.instant) {
        moments.add(read.instant.epochMilliseconds);
      }
    }
  }
  return moments;
}

/**
 * A several-times-a-day series' skipped times, each at its rule's new
 * time; `line` itself when none moves.
 */
function retimedList(
  name: string,
  values: RecurrenceValue[],
  seriesZone: string,
  retime: (
    day: Temporal.PlainDate,
    time: Temporal.PlainTime
  ) => Temporal.PlainTime[],
  line: string
): string {
  let moved = false;
  const written = values.flatMap((value) => {
    const time = (value.instant as Temporal.Instant)
      .toZonedDateTimeISO(seriesZone)
      .toPlainTime();
    const next = retime(value.day, time);
    moved ||= !(
      next.length === 1 &&
      next[0] &&
      Temporal.PlainTime.compare(next[0], time) === 0
    );
    return next.map((at) => `${compactDate(value.day)}T${compactTime(at)}`);
  });
  if (!moved) {
    return line;
  }
  return written.length > 0
    ? `${name};TZID=${seriesZone}:${[...new Set(written)].join(",")}`
    : "";
}

/**
 * An RRULE whose single BYHOUR / BYMINUTE / BYSECOND fixes the time set to
 * the start's (moving a "BYHOUR=9" series to 10:00 moves the rule too, or
 * it keeps meeting at 9). A series that meets several times a day (several
 * values, or rules at different times) keeps its own times.
 */
function matchClock(
  line: string,
  start: StartTime,
  timeZone: string,
  severalADay: boolean,
  /** Made all day: drop the rule's times (it has none). */
  dropTimes = true
): string {
  if (start.date && dropTimes && !SUB_DAILY.test(line)) {
    // An all-day rule has no time of day.
    return `RRULE:${line
      .slice("RRULE:".length)
      .split(";")
      .filter((part) => !CLOCK_PART_NAME.test(part))
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
    /([:;])(BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g,
    (_, separator: string, part: keyof typeof parts) =>
      `${separator}${part}=${parts[part]}`
  );
}

/** An RRULE line with its UNTIL in the start's form. */
function matchUntil(line: string, allDay: boolean, timeZone: string): string {
  const match = UNTIL_PART.exec(line);
  const until = match?.[2];
  if (!(match && until) || until.includes("T") !== allDay) {
    return line;
  }
  const day = untilRuleToDay(until, timeZone);
  return day
    ? line.replace(
        UNTIL_PART,
        `${match[1]}UNTIL=${untilRuleForDay(day, allDay, timeZone)}`
      )
    : line;
}

/**
 * `recurrence` in the form `start` takes, as Google requires: UNTIL and
 * EXDATE/RDATE values are dates for an all-day series and date-times for a
 * timed one (that day's last second for UNTIL; a skipped occurrence at the
 * series' start time on its day in `timeZone`, the series' zone, so it
 * stays skipped). The same array when it already is. `seriesStart`, the
 * series' start before the edit, tells which rules share its time.
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
     * The series' first meeting's time that day (COUNT counts from it, and
     * a rule's left-out time parts are its), when not `seriesStart`'s.
     */
    firstTime?: Temporal.PlainTime | null;
    /**
     * Edited through an occurrence: an all-day rule keeps its times and
     * COUNT for the server to carry and convert from the series' start.
     */
    viaOccurrence?: boolean;
  }
): string[] {
  const allDay = Boolean(start.date);
  const base = seriesStart?.dateTime ? wallClock(seriesStart, timeZone) : null;
  const severalADay = meetsSeveralTimesADay(recurrence, base);
  // A several-times-a-day series whose start's time changed: each skipped
  // time moves with the rule it belongs to (a rule without BYHOUR meets
  // at the start's hour), others' stay.
  const newTime = start.dateTime ? wallClock(start, timeZone) : null;
  const startDay = start.dateTime ? dayOfStart(start, timeZone) : null;
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const baseDay = seriesStart ? dayOfStart(seriesStart, timeZone) : null;
  const added = addedMoments(recurrence, timeZone);
  // Where COUNT counts from: without word from the caller, the new start
  // is the series' first (on the server it is the series' own start).
  let countFrom: Temporal.PlainDate | null = null;
  // Made all day, the rule loses its times (and a COUNT over several a day
  // becomes days) where the start is the series' own: on the server, or
  // editing the series itself. Edited through an occurrence (days given),
  // the rule goes as it is, so the server can carry a split's COUNT on
  // and convert it from the new series' start.
  const convertsRule = Boolean(start.date) && !days?.viaOccurrence;
  // The series' own first meeting time, for counting its meetings.
  const countBase = days?.firstTime ?? base;
  if (start.date) {
    countFrom = days ? days.firstDay : Temporal.PlainDate.from(start.date);
  }
  const keepAsDate = start.date
    ? allDayDates({
        // Rules that take their day from the start count from the new
        // one (followStart has moved them and their skips there), unless
        // the caller says they didn't move.
        anchor: days?.rulesFrom ?? Temporal.PlainDate.from(start.date),
        base: countBase,
        countFrom,
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
          // The rules that met at this skipped day and time, each moving
          // its own part of the time to the new start's (a rule that sets
          // all of it stays). Every one that still meets keeps it skipped.
          const owners = rules.filter(
            (rule) =>
              isRuleDay(rule, baseDay, day) !== false &&
              !endedBefore(rule, baseDay, day, timeZone) &&
              ruleMeetsAt(rule, time, base)
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
                ruleMeetsAt(rule, at, newTime)
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
  let changed = false;
  const next = recurrence.flatMap((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchClock(
          matchUntil(
            convertsRule
              ? countInDays(line, countBase, countFrom, timeZone)
              : line,
            allDay,
            timeZone
          ),
          start,
          timeZone,
          severalADay,
          convertsRule
        )
      : matchDateList(
          line,
          start,
          timeZone,
          severalADay,
          retime,
          added,
          keepAsDate
        );
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
 * Where a monthly or yearly skip sits once the move is applied in calendar
 * terms: the move's months (years for a rule in one month a year) within
 * INTERVAL, then its leftover days. Of the two ways to say a move (Temporal's
 * "Mar 1 -> Jan 31 is a month and a day back", or month to month and day to
 * day, "Mar 15 -> Apr 14 is a month on, a day back"), the one with fewer
 * leftover days is the move, so February and 30-day moves land right.
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
 * Where a skipped occurrence of the old pattern sits in the new one: moved
 * as the pattern did, by the move's signed shift within one period (Fri
 * -> Mon is +3 days; a weekly rule that kept its days moves only by the
 * weeks; Jan 31 -> Feb 1 is a day, Feb 1 -> Mar 2 a day, a month's move
 * plus 5 days is 5 days), on the new rule's day nearest that. A skip marks when the person is
 * away, so it stays next to that time. Null when the new rule has no day
 * within half a period: the skip then stays.
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
 * EXDATE days moved with a series whose pattern followed its start from
 * `from` to `to` (Mondays became Tuesdays, the 2nd Tue the 3rd Wed): a
 * skipped occurrence of the old pattern on or after `from` that the new
 * rule no longer produces moves to its place in the new pattern (the same shift for a daily or
 * weekly rule; the new rule's day in that month for a monthly or yearly
 * one), at its own time, so it stays skipped. One the new rule still
 * produces is a skipped date, and stays. The same array when none moves.
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
    // Only a skipped occurrence of the old pattern that the new one no
    // longer has moves; any other skipped day is a date, and stays.
    if (
      isRuleDay(oldRule, from, day) !== true ||
      isRuleDay(newRule, to, day) !== false
    ) {
      return null;
    }
    const place = placeInNewPattern(freq, newRule, from, to, day);
    // A place before the new start matches nothing, the new start is the
    // meeting just moved there, and a day the old pattern met on was a
    // real meeting: the skip never lands on any of them.
    return place &&
      Temporal.PlainDate.compare(place, to) > 0 &&
      isRuleDay(oldRule, from, place) !== true
      ? place
      : null;
  };
  // The new start is the day the person picked: never left skipped (in a
  // rule with several times a day, only the start's own time is: a
  // skipped other time that day stays).
  const severalADay = meetsSeveralTimesADay(recurrence, fromTime);
  // In a series that meets several times a day, a skipped time moves only
  // if the moved rule meets then: another rule's (a 15:00 rule left on
  // Mondays) stays with it.
  const ownSkip = (value: RecurrenceValue) =>
    !(severalADay && value.instant) ||
    ruleMeetsAt(
      oldRule,
      value.instant.toZonedDateTimeISO(seriesZone).toPlainTime(),
      fromTime
    );
  const wallTime = (value: RecurrenceValue) =>
    value.instant?.toZonedDateTimeISO(seriesZone).toPlainTime() ?? null;
  // The series' other rules meet on their own: a skip one of them still
  // needs stays, and a skip never lands on one of their meetings. (A rule
  // that can't be read counts as meeting, so nothing moves.)
  const otherRules = recurrence
    .filter((line) => line.startsWith("RRULE:"))
    .slice(1);
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
        (!time || ruleMeetsAt(rule, time, base))
    );
  // Where a skip moves, at its time: a part of it the moved rule leaves
  // out (it meets at the start's hour, say) follows the new start.
  // An added (RDATE) meeting is its own: its skip stays with it, and no
  // skip moves onto one, which it would cancel.
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
  // A skip of the moved rule that stays on its day still moves to the
  // rule's new time (in a series several times a day; otherwise every
  // skip takes the start's time when the rule is lined up with it).
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
    // A skip at another time that day is its own: in a series several
    // times a day, or an added meeting's (cancelled, it stays cancelled).
    // An all-day start takes the whole day: every skip on it goes.
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
    const values = read.flatMap((value, index) => {
      if (dropped[index]) {
        return [];
      }
      const day = moved[index]?.day ?? value?.day;
      if (!(value && day)) {
        return [list.values[index] ?? ""];
      }
      const time = moved[index]?.time ?? wallTime(value);
      return [
        time ? `${compactDate(day)}T${compactTime(time)}` : compactDate(day),
      ];
    });
    if (values.length === 0) {
      return [];
    }
    return [
      timed
        ? `${list.name};TZID=${seriesZone}:${[...new Set(values)].join(",")}`
        : `${list.name};VALUE=DATE:${[...new Set(values)].join(",")}`,
    ];
  });
  return changed ? next : recurrence;
}
