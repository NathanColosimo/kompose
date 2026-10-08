import type { Temporal } from "temporal-polyfill";

/** Resolve both the indicator's day and wall-clock position in the displayed zone. */
export function currentTimePosition(
  date: Temporal.PlainDate,
  timeZone: string,
  now: Temporal.ZonedDateTime,
  pixelsPerHour: number
): number | null {
  const localNow = now.withTimeZone(timeZone);
  if (!localNow.toPlainDate().equals(date)) {
    return null;
  }
  return (localNow.hour + localNow.minute / 60) * pixelsPerHour;
}
