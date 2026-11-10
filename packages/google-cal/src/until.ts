/**
 * Reading a series' times: its EXDATE/RDATE values, a start's moment,
 * clock and length, and how often its rules meet in a day.
 */
import { Temporal } from "temporal-polyfill";

/** A Google date ("2026-11-16"), as an all-day start writes it. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

const FREQ = /FREQ=([A-Z]+)/;
const INTERVAL = /INTERVAL=(\d+)/;
const TIME_PART = /BY(?:HOUR|MINUTE|SECOND)=/;
/**
 * A time part a rule sets to one value. Google meets a rule once a day, at
 * the start's time, and ignores a list ("BYHOUR=9,15"), so a list reads as
 * left out.
 */
const CLOCK_PART = /[:;](BYHOUR|BYMINUTE|BYSECOND)=(\d+)(?=;|$)/g;

/**
 * A rule's time of day as a key, "9:0:0". A part it leaves out is the
 * start's (`base`).
 */
function ruleTime(line: string, base: Temporal.PlainTime): string {
  const parts = clockParts(line);
  const fallback = [base.hour, base.minute, base.second];
  return ["BYHOUR", "BYMINUTE", "BYSECOND"]
    .map((name, index) => parts.get(name) ?? fallback[index])
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
  const steps = STEPS_A_DAY[FREQ.exec(line)?.[1] ?? ""];
  if (!steps) {
    return false;
  }
  const interval = Number(INTERVAL.exec(line)?.[1] ?? "1");
  return interval % steps !== 0 || TIME_PART.test(line);
}

/**
 * Whether a series meets more than once a day: a sub-daily rule, or rules
 * at different times. The start, at `base`, counts as a meeting, and its
 * time fills the parts a rule leaves out. Such a series' times are its
 * own: they don't follow the start.
 */
export function meetsSeveralTimesADay(
  recurrence: string[],
  base: Temporal.PlainTime
): boolean {
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  const times = new Set(rules.map((line) => ruleTime(line, base)));
  times.add(ruleTime("", base));
  return rules.some(stepsWithinADay) || times.size > 1;
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
