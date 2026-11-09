/**
 * A series' UNTIL and EXDATE/RDATE lines, kept in the form Google requires:
 * dates for an all-day series, date-times for a timed one. Shared by the
 * server and both apps.
 */
import { Temporal } from "temporal-polyfill";
import { isRuleDay } from "./rule-days";

/** A Google date ("2026-11-16"), as an all-day start writes it. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

/** How far a COUNT rule's meetings are walked: fifty years of days. */
const MAX_COUNT_DAYS = 366 * 50;
/** A rule that repeats within a day: its times don't follow the start's. */
const SUB_DAILY = /FREQ=(?:HOURLY|MINUTELY|SECONDLY)/;
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

/**
 * Whether a series meets more than once a day: a sub-daily rule, or rules
 * at different times. With the start's time `base`, the start counts as a
 * meeting and fills the parts a rule leaves out; without it, rules written
 * differently count as different. Such a series' times are its own: they
 * don't follow the start.
 */
export function meetsSeveralTimesADay(
  recurrence: string[],
  base: Temporal.PlainTime | null = null
): boolean {
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const times = new Set(rules.map((line) => ruleTime(line, base)));
  if (base) {
    times.add(ruleTime("", base));
  }
  return rules.some((line) => SUB_DAILY.test(line)) || times.size > 1;
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
 * counted. Used where Google can't be asked; where it can (a split's
 * COUNT), its own list of meetings decides.
 */
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
 * A COUNT rule's `count` meetings as epoch ms, at `time` on its days,
 * counted from the series' first day `from` at start time `base`. Null
 * when its days can't be read or don't all fit in the walk.
 */
export function countedRuleMeetings(params: {
  base: Temporal.PlainTime | null;
  count: number;
  from: Temporal.PlainDate;
  rule: string;
  time: Temporal.PlainTime;
  timeZone: string;
}): Set<number> | null {
  const { base, count, from, rule, time, timeZone } = params;
  const at = (day: Temporal.PlainDate, clock: Temporal.PlainTime) =>
    day.toZonedDateTime({ plainTime: clock, timeZone }).epochMilliseconds;
  const first = base ? at(from, base) : null;
  // The first start is a meeting of a rule at its time, rule day or not
  // (RFC 5545 counts DTSTART; Google does too). A rule at another time
  // (15:00 beside a 9:00 start) doesn't meet then.
  const atStart = base !== null && Temporal.PlainTime.compare(time, base) === 0;
  const meetings = new Set<number>(
    first !== null && base && atStart && existsOn(from, base, timeZone)
      ? [first]
      : []
  );
  if (meetings.size === count) {
    return meetings;
  }
  for (let offset = 0; offset < MAX_COUNT_DAYS; offset += 1) {
    const day = from.add({ days: offset });
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
