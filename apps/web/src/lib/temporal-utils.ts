import { Temporal } from "temporal-polyfill";

export function getSystemTimeZone() {
  return Temporal.Now.zonedDateTimeISO().timeZoneId;
}

export function todayPlainDate(
  timeZone = getSystemTimeZone()
): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

export function addDays(
  date: Temporal.PlainDate,
  days: number
): Temporal.PlainDate {
  return date.add({ days });
}

export function subDays(
  date: Temporal.PlainDate,
  days: number
): Temporal.PlainDate {
  return date.subtract({ days });
}

export function startOfMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: 1 });
}

export function endOfMonth(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: date.daysInMonth });
}

export function startOfDayZoned(
  date: Temporal.PlainDate,
  timeZone: string
): Temporal.ZonedDateTime {
  return date.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
}

/**
 * Returns the exclusive end of day (start of next day).
 * Use this for range queries: [startOfDay, endOfDay) where endOfDay is exclusive.
 */
export function endOfDayZoned(
  date: Temporal.PlainDate,
  timeZone: string
): Temporal.ZonedDateTime {
  return date
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .add({ days: 1 });
}

export function plainDateToDate(
  date: Temporal.PlainDate,
  timeZone: string
): Date {
  return new Date(
    startOfDayZoned(date, timeZone).toInstant().epochMilliseconds
  );
}

export function dateToPlainDate(
  date: Date,
  timeZone: string
): Temporal.PlainDate {
  return Temporal.Instant.from(date.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
}

/**
 * Parse a timestamp string to ZonedDateTime.
 * Handles:
 * - UTC timestamps ending in 'Z' (e.g., "2025-12-12T21:00:00Z" from API)
 * - Postgres format with space (e.g., "2025-12-12 03:45:00" from TIMESTAMP column)
 */
export function isoStringToZonedDateTime(
  isoString: string,
  timeZone: string
): Temporal.ZonedDateTime {
  // UTC timestamp (from toInstant().toString())
  if (isoString.endsWith("Z")) {
    return Temporal.Instant.from(isoString).toZonedDateTimeISO(timeZone);
  }
  // Normalize Postgres format "2025-12-12 03:45:00" to ISO "2025-12-12T03:45:00"
  const normalized = isoString.includes("T")
    ? isoString
    : isoString.replace(" ", "T");
  // Parse as local datetime and convert to timezone
  const plainDateTime = Temporal.PlainDateTime.from(normalized);
  return plainDateTime.toZonedDateTime(timeZone);
}

export function formatPlainDate(
  date: Temporal.PlainDate,
  options?: Intl.DateTimeFormatOptions
) {
  return date.toLocaleString(undefined, options ?? { dateStyle: "medium" });
}

export function formatTime(
  zdt: Temporal.ZonedDateTime,
  options?: Intl.DateTimeFormatOptions
) {
  return zdt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
  });
}

export function isSameDay(
  a: Temporal.ZonedDateTime,
  b: Temporal.ZonedDateTime
): boolean {
  return a.toPlainDate().equals(b.toPlainDate());
}

/** Check if a PlainDate is today in the given timezone */
export function isToday(
  date: Temporal.PlainDate,
  timeZone = getSystemTimeZone()
): boolean {
  return date.equals(todayPlainDate(timeZone));
}

/** Format hour as "8 AM" style label */
export function formatHourLabel(hour: number): string {
  const time = new Temporal.PlainTime(hour, 0);
  return time.toLocaleString(undefined, { hour: "numeric" });
}

/** Convert a ZonedDateTime to a native Date */
export function zonedDateTimeToDate(zdt: Temporal.ZonedDateTime): Date {
  return new Date(zdt.toInstant().epochMilliseconds);
}

/** Get start and end of day as ZonedDateTime for a PlainDate */
export function getDayBoundsZoned(
  date: Temporal.PlainDate,
  timeZone: string
): { dayStart: Temporal.ZonedDateTime; dayEnd: Temporal.ZonedDateTime } {
  const dayStart = startOfDayZoned(date, timeZone);
  const dayEnd = dayStart.add({ days: 1 });
  return { dayStart, dayEnd };
}

/** Clamp a ZonedDateTime between min and max */
export function clampZonedDateTime(
  value: Temporal.ZonedDateTime,
  min: Temporal.ZonedDateTime,
  max: Temporal.ZonedDateTime
): Temporal.ZonedDateTime {
  if (Temporal.ZonedDateTime.compare(value, min) < 0) {
    return min;
  }
  if (Temporal.ZonedDateTime.compare(value, max) > 0) {
    return max;
  }
  return value;
}

/** Calculate position in minutes from start of day */
export function minutesFromMidnight(zdt: Temporal.ZonedDateTime): number {
  return zdt.hour * 60 + zdt.minute;
}

/** Convert Date to YYYY-MM-DD string in local timezone (for date-only fields) */
export function dateToDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Convert YYYY-MM-DD string to Date (parsed as local time) */
export function dateStringToDate(str: string): Date {
  return new Date(`${str}T00:00`);
}

/** Format a YYYY-MM-DD date string for display */
export function formatDateString(
  str: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return Temporal.PlainDate.from(str).toLocaleString(
    undefined,
    options ?? { month: "short", day: "numeric" }
  );
}

/**
 * Format a timestamp string for display.
 * Handles UTC timestamps (ending in 'Z') and Postgres format (space instead of T).
 */
export function formatTimestampString(
  str: string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const zdt = isoStringToZonedDateTime(str, timeZone);
  return zdt.toLocaleString(
    undefined,
    options ?? { weekday: "short", hour: "numeric", minute: "2-digit" }
  );
}
