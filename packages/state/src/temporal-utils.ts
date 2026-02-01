import { Temporal } from "temporal-polyfill";

/**
 * Return the system timezone identifier.
 */
export function getSystemTimeZone(): string {
  return Temporal.Now.zonedDateTimeISO().timeZoneId;
}

/**
 * Return today's date as a PlainDate in the given timezone.
 */
export function todayPlainDate(
  timeZone = getSystemTimeZone()
): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

/**
 * Convert a PlainDate to a ZonedDateTime at midnight (start of day).
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
 * Return the exclusive end of day (start of next day) for range queries.
 */
export function endOfDayZoned(
  date: Temporal.PlainDate,
  timeZone: string
): Temporal.ZonedDateTime {
  return date
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .add({ days: 1 });
}
