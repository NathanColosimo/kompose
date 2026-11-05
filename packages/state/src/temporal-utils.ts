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
