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

/** An EXDATE/RDATE line with its values in the start's form. */
function matchDateList(
  line: string,
  allDay: boolean,
  start: StartTime,
  timeZone: string
): string {
  const match = DATE_LIST.exec(line);
  if (!match) {
    return line;
  }
  const [, name, params = "", list = ""] = match;
  const values = list.split(",");
  const datesOnly = values.every((value) => UNTIL_DATE.test(value));
  if (datesOnly === allDay) {
    return line;
  }
  const zone = TZID_PARAM.exec(params)?.[1] ?? timeZone;
  const days = values.map((value) => untilRuleToDay(value, zone));
  if (days.some((day) => day === null)) {
    return line;
  }
  const valid = days as Temporal.PlainDate[];
  if (allDay) {
    return `${name};VALUE=DATE:${valid.map(compactDate).join(",")}`;
  }
  // A date made timed: the occurrence at the series' start time that day.
  const time = wallClock(start, timeZone)
    .toString({ smallestUnit: "second" })
    .replace(/:/g, "");
  return `${name};TZID=${timeZone}:${valid
    .map((day) => `${compactDate(day)}T${time}`)
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
 * timed one (that day's last second for UNTIL; the series' start time for
 * the occurrences, so a skipped one stays skipped). The same array when it
 * already is.
 */
export function matchRecurrenceToStart(
  recurrence: string[],
  start: StartTime,
  timeZone: string
): string[] {
  const allDay = Boolean(start.date);
  let changed = false;
  const next = recurrence.map((line) => {
    const matched = line.startsWith("RRULE:")
      ? matchUntil(line, allDay, timeZone)
      : matchDateList(line, allDay, start, timeZone);
    changed ||= matched !== line;
    return matched;
  });
  return changed ? next : recurrence;
}
