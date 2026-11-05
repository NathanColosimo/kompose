import { endOfDayZoned, startOfDayZoned } from "@kompose/state/temporal-utils";
import { Temporal } from "temporal-polyfill";

const TIMEZONE_OFFSET_PATTERN = /[+-]\d{2}:\d{2}$/;

/**
 * Parse a timestamp string to ZonedDateTime.
 * Handles:
 * - UTC timestamps ending in 'Z' (e.g., "2025-12-12T21:00:00Z" from API)
 * - ISO strings with timezone offsets (e.g., "2025-12-12T10:00:00-05:00" from Google Calendar)
 * - Postgres format with space (e.g., "2025-12-12 03:45:00" from TIMESTAMP column)
 */
export function isoStringToZonedDateTime(
  isoString: string,
  timeZone: string
): Temporal.ZonedDateTime {
  if (isoString.endsWith("Z")) {
    return Temporal.Instant.from(isoString).toZonedDateTimeISO(timeZone);
  }

  if (TIMEZONE_OFFSET_PATTERN.test(isoString)) {
    return Temporal.Instant.from(isoString).toZonedDateTimeISO(timeZone);
  }

  // Normalize Postgres format "2025-12-12 03:45:00" to ISO "2025-12-12T03:45:00"
  const normalized = isoString.includes("T")
    ? isoString
    : isoString.replace(" ", "T");
  const plainDateTime = Temporal.PlainDateTime.from(normalized);
  return plainDateTime.toZonedDateTime(timeZone);
}

export function formatPlainDate(
  date: Temporal.PlainDate,
  options?: Intl.DateTimeFormatOptions
) {
  return date.toLocaleString(undefined, options ?? { dateStyle: "medium" });
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

/** Format an hour using the locale's hour cycle. */
export function formatHourLabel(hour: number): string {
  const time = new Temporal.PlainTime(hour, 0);
  return time.toLocaleString(undefined, { hour: "numeric" });
}

export function zonedDateTimeToDate(zdt: Temporal.ZonedDateTime): Date {
  return new Date(zdt.toInstant().epochMilliseconds);
}

/** Day bounds with an exclusive end at the start of the next day. */
export function getDayBoundsZoned(
  date: Temporal.PlainDate,
  timeZone: string
): { dayStart: Temporal.ZonedDateTime; dayEnd: Temporal.ZonedDateTime } {
  return {
    dayEnd: endOfDayZoned(date, timeZone),
    dayStart: startOfDayZoned(date, timeZone),
  };
}

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

// Pickers use local calendar dates; preserve their fields without converting time zones.

/** Preserve the calendar date at local midnight for date pickers. */
export function temporalToPickerDate(date: Temporal.PlainDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

export function pickerDateToTemporal(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
}

/** Local HH:mm for time inputs. */
export function formatTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
