import { Temporal } from "temporal-polyfill";

export function getSystemTimeZone(): string {
  return Temporal.Now.zonedDateTimeISO().timeZoneId;
}

export function todayPlainDate(
  timeZone = getSystemTimeZone()
): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

export function startOfDayZoned(
  date: Temporal.PlainDate,
  timeZone: string
): Temporal.ZonedDateTime {
  return date.toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone,
  });
}

/**
 * Return the exclusive end of day (start of next day) for range queries.
 */
export function endOfDayZoned(
  date: Temporal.PlainDate,
  timeZone: string
): Temporal.ZonedDateTime {
  return date
    .toZonedDateTime({ plainTime: Temporal.PlainTime.from("00:00"), timeZone })
    .add({ days: 1 });
}

/** A duration for display: 30 → "30m", 90 → "1h 30m", 120 → "2h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const rangeFormats = new Map<string, Intl.DateTimeFormat>();

function rangeFormat(
  timeZone: string,
  withMinutes: boolean,
  withDate: boolean
): Intl.DateTimeFormat {
  const key = `${timeZone}|${withMinutes}|${withDate}`;
  let format = rangeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, {
      day: withDate ? "numeric" : undefined,
      hour: "numeric",
      minute: withMinutes ? "2-digit" : undefined,
      month: withDate ? "short" : undefined,
      timeZone,
    });
    rangeFormats.set(key, format);
  }
  return format;
}

function formatParts(
  format: Intl.DateTimeFormat,
  epochMilliseconds: number,
  dropDayPeriod: boolean
): { dayPeriod: string; text: string } {
  const parts = format.formatToParts(epochMilliseconds);
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value;
  const kept = dropDayPeriod
    ? parts.filter((part) => part.type !== "dayPeriod")
    : parts;
  return {
    dayPeriod: dayPeriod ?? "",
    text: kept
      .map((part) => part.value)
      .join("")
      .trim(),
  };
}

/**
 * A compact time range in the locale's style, shared by web and mobile:
 * "10 AM – 12 PM" on the hour, "9:00 – 9:30 AM" within one half of the day,
 * times only for an overnight range ("11 PM – 7 AM"), and dates once the
 * range spans more than one night ("Nov 6 at 9 AM – Nov 8 at 5 PM").
 */
export function formatTimeRange(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): string {
  const nights = start
    .toPlainDate()
    .until(end.toPlainDate(), { largestUnit: "days" }).days;
  const withDate = nights > 1;
  const format = rangeFormat(
    start.timeZoneId,
    !(start.minute === 0 && end.minute === 0),
    withDate
  );
  const endParts = formatParts(format, end.epochMilliseconds, false);
  const startPeriod = formatParts(format, start.epochMilliseconds, false);
  // Say AM or PM once when both ends share it on the same day.
  const shared = nights === 0 && startPeriod.dayPeriod === endParts.dayPeriod;
  const startText = shared
    ? formatParts(format, start.epochMilliseconds, true).text
    : startPeriod.text;
  return `${startText} – ${endParts.text}`;
}
