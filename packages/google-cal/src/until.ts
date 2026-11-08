/**
 * A series' UNTIL and its EXDATE/RDATE lines: an UNTIL written so the end
 * day's occurrence is included, read back as a day, and every value kept
 * in the form Google requires (dates for an all-day series, date-times for
 * a timed one). Shared by the server and both apps.
 */
import { Temporal } from "temporal-polyfill";

const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;
const DATE_LIST = /^(EXDATE|RDATE)([^:]*):(.+)$/;
const TZID_PARAM = /;TZID=([^;:]+)/;
const SEVERAL_A_DAY =
  /(?:[:;])(?:FREQ=(?:HOURLY|MINUTELY|SECONDLY)|BYHOUR=|BYMINUTE=|BYSECOND=)/;

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

function compactDate(day: Temporal.PlainDate): string {
  return day.toString().replace(/-/g, "");
}

/** A start as Google writes it: a date (all day) or a date-time. */
interface StartTime {
  date?: string | null;
  dateTime?: string | null;
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
    if (!offset) {
      instant = Temporal.PlainDateTime.from(local)
        .toZonedDateTime(valueZone)
        .toInstant();
    } else {
      const zone =
        offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
      instant = Temporal.Instant.from(`${local}${zone}`);
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
  severalADay: boolean
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
    return values.every((value) => value.instant === null)
      ? line
      : `${list.name};VALUE=DATE:${values.map((v) => compactDate(v.day)).join(",")}`;
  }
  // Times of their own stay theirs: an RDATE's, or any in a rule with
  // several times a day (moving a skipped 15:00 to the start's 9:00 would
  // un-skip it).
  if (
    (list.name === "RDATE" || severalADay) &&
    values.every((value) => value.instant)
  ) {
    return line;
  }
  const time = wallClock(start, seriesZone);
  const moments = values.map((value) =>
    value.day.toZonedDateTime({ plainTime: time, timeZone: seriesZone })
  );
  const same = moments.every(
    (moment, index) =>
      values[index]?.instant &&
      Temporal.Instant.compare(
        moment.toInstant(),
        values[index].instant as Temporal.Instant
      ) === 0
  );
  if (same) {
    return line;
  }
  const clock = time.toString({ smallestUnit: "second" }).replace(/:/g, "");
  return `${list.name};TZID=${seriesZone}:${values
    .map((value) => `${compactDate(value.day)}T${clock}`)
    .join(",")}`;
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
 * stays skipped). The same array when it already is.
 */
export function matchRecurrenceToStart(
  recurrence: string[],
  start: StartTime,
  timeZone: string
): string[] {
  const allDay = Boolean(start.date);
  const severalADay = recurrence.some(
    (line) => line.startsWith("RRULE:") && SEVERAL_A_DAY.test(line)
  );
  let changed = false;
  const next = recurrence.map((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchUntil(line, allDay, timeZone)
      : matchDateList(line, start, timeZone, severalADay);
    changed ||= matched !== line;
    return matched;
  });
  return changed ? next : recurrence;
}
