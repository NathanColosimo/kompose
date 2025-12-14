import { Temporal } from "temporal-polyfill";

/** Regex pattern to match timezone offsets at the end of ISO strings (e.g., "+05:00", "-05:00") */
const TIMEZONE_OFFSET_PATTERN = /[+-]\d{2}:\d{2}$/;

/** Get the system/browser timezone identifier (e.g., "America/New_York") */
export function getSystemTimeZone() {
  return Temporal.Now.zonedDateTimeISO().timeZoneId;
}

/** Get today's date as a PlainDate in the given timezone */
export function todayPlainDate(
  timeZone = getSystemTimeZone()
): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

/**
 * Convert a PlainDate to a ZonedDateTime at midnight (start of day).
 * Use this for building range query start bounds.
 */
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

/**
 * Convert a PlainDate to a native Date at midnight in the given timezone.
 * Used for UI pickers (e.g., shadcn Calendar) that require native Date objects.
 */
export function plainDateToDate(
  date: Temporal.PlainDate,
  timeZone: string
): Date {
  return new Date(
    startOfDayZoned(date, timeZone).toInstant().epochMilliseconds
  );
}

/**
 * Convert a native Date to a PlainDate in the given timezone.
 * Used for UI pickers (e.g., shadcn Calendar) that return native Date objects.
 */
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
 * - ISO strings with timezone offsets (e.g., "2025-12-12T10:00:00-05:00" from Google Calendar)
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

  // Check if string has a timezone offset (e.g., "+05:00" or "-05:00")
  // Pattern matches: timezone offset at the end of the string
  if (TIMEZONE_OFFSET_PATTERN.test(isoString)) {
    // Parse as Instant (handles offsets), then convert to target timezone
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

/**
 * Format a PlainDate for display using Intl.DateTimeFormat.
 * Default format: "Dec 15, 2025" (dateStyle: "medium")
 */
export function formatPlainDate(
  date: Temporal.PlainDate,
  options?: Intl.DateTimeFormatOptions
) {
  return date.toLocaleString(undefined, options ?? { dateStyle: "medium" });
}

/**
 * Format a ZonedDateTime's time portion for display.
 * Default format: "9:30 AM" (hour: "numeric", minute: "2-digit")
 */
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

/** Check if two ZonedDateTimes fall on the same calendar day */
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

// ============================================================================
// Date Picker Boundary Helpers
// These convert between Temporal types and native Date for UI pickers.
// Unlike plainDateToDate/dateToPlainDate, these work in local time without
// timezone conversion since pickers already operate in local time.
// ============================================================================

/**
 * Convert a Temporal.PlainDate to a native Date for date picker components.
 * The returned Date represents the same calendar date at midnight local time.
 */
export function temporalToPickerDate(date: Temporal.PlainDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

/**
 * Convert a native Date from a date picker to Temporal.PlainDate.
 * Extracts the local calendar date components.
 */
export function pickerDateToTemporal(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/**
 * Format a native Date to HH:mm string for time inputs.
 * Used at picker boundaries where native Date is required.
 */
export function formatTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Convert a Temporal.PlainDateTime to a native Date for picker components.
 * Creates a Date in the local timezone.
 */
export function plainDateTimeToPickerDate(pdt: Temporal.PlainDateTime): Date {
  return new Date(pdt.year, pdt.month - 1, pdt.day, pdt.hour, pdt.minute, 0, 0);
}
