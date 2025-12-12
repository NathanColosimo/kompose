import { Temporal } from "@js-temporal/polyfill";

export type PlainDate = Temporal.PlainDate;
export type ZonedDateTime = Temporal.ZonedDateTime;

export function getSystemTimeZone() {
  return Temporal.Now.zonedDateTimeISO().timeZoneId;
}

export function todayPlainDate(timeZone = getSystemTimeZone()): PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return date.add({ days });
}

export function subDays(date: PlainDate, days: number): PlainDate {
  return date.subtract({ days });
}

export function startOfMonth(date: PlainDate): PlainDate {
  return date.with({ day: 1 });
}

export function endOfMonth(date: PlainDate): PlainDate {
  return date.with({ day: date.daysInMonth });
}

export function startOfDayZoned(date: PlainDate, timeZone: string): ZonedDateTime {
  return date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") });
}

export function endOfDayZoned(date: PlainDate, timeZone: string): ZonedDateTime {
  return date
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .add({ days: 1, milliseconds: -1 });
}

export function plainDateToDate(date: PlainDate, timeZone: string): Date {
  return new Date(startOfDayZoned(date, timeZone).toInstant().epochMilliseconds);
}

export function dateToPlainDate(date: Date, timeZone: string): PlainDate {
  return Temporal.Instant.from(date.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
}

export function isoStringToZonedDateTime(isoString: string, timeZone: string): ZonedDateTime {
  return Temporal.Instant.from(isoString).toZonedDateTimeISO(timeZone);
}

export function formatPlainDate(date: PlainDate, options?: Intl.DateTimeFormatOptions) {
  return date.toLocaleString(undefined, options ?? { dateStyle: "medium" });
}

export function formatTime(zdt: ZonedDateTime, options?: Intl.DateTimeFormatOptions) {
  return zdt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
  });
}

export function combineDateAndTime(
  date: PlainDate,
  time: string,
  timeZone: string
): ZonedDateTime | null {
  if (!time) {
    return null;
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return date.toZonedDateTime({
    timeZone,
    plainTime: new Temporal.PlainTime(hours, minutes),
  });
}

export function isSameDay(a: ZonedDateTime, b: ZonedDateTime): boolean {
  return a.toPlainDate().equals(b.toPlainDate());
}

export function shiftMinutes(zdt: ZonedDateTime, minutes: number): ZonedDateTime {
  return zdt.add({ minutes });
}

export function durationMinutesBetween(start: ZonedDateTime, end: ZonedDateTime): number {
  return end.since(start).total({ unit: "minutes" });
}
