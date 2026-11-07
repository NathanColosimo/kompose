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
  locale: string | undefined,
  timeZone: string,
  withMinutes: boolean,
  withDate: boolean
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${withMinutes}|${withDate}`;
  let format = rangeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
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
  // Only a trailing AM/PM ("9:00 AM") can be dropped from the start; where
  // it leads ("오전 9:00") both ends keep it.
  const periodLast =
    parts.filter((part) => part.type !== "literal").at(-1)?.type ===
    "dayPeriod";
  const kept =
    dropDayPeriod && periodLast
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
 * range lasts a day or more ("Nov 6, 9 AM – Nov 8, 5 PM").
 */
/**
 * Whether formatTimeRange prints dates: for a day or longer. Overnight
 * ranges shorter than a day ("11 PM – 7 AM") read fine as times on the grid.
 */
function rangeShowsDates(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime
): boolean {
  const nights = start
    .toPlainDate()
    .until(end.toPlainDate(), { largestUnit: "days" }).days;
  return (
    nights > 1 ||
    (nights === 1 &&
      Temporal.PlainTime.compare(end.toPlainTime(), start.toPlainTime()) >= 0)
  );
}

const WHEN_DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  weekday: "short",
};

/**
 * When an event happens, for a view without a grid around it: the day,
 * then the times ("Thu, Nov 12 · 9 – 10 AM"). One that ends on a later day
 * names both days ("Thu, Nov 12, 11 PM – Fri, Nov 13, 7 AM"); an end at
 * midnight still reads as the first day's.
 */
export function formatEventWhen(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  locale?: string
): string {
  const startDay = start.toPlainDate();
  const endDay = end.subtract({ nanoseconds: 1 }).toPlainDate();
  if (Temporal.PlainDate.compare(endDay, startDay) <= 0) {
    return `${startDay.toLocaleString(locale, WHEN_DAY)} · ${formatTimeRange(start, end, locale)}`;
  }
  const at = (time: Temporal.ZonedDateTime) =>
    `${time.toPlainDate().toLocaleString(locale, WHEN_DAY)}, ${formatClockTimeWithPeriod(time, locale)}`;
  return `${at(start)} – ${at(end)}`;
}

/** A time with its AM/PM where the locale uses one ("11 PM", "7:30 AM"). */
function formatClockTimeWithPeriod(
  time: Temporal.ZonedDateTime,
  locale?: string
): string {
  return formatParts(
    rangeFormat(locale, time.timeZoneId, time.minute !== 0, false),
    time.epochMilliseconds,
    false
  ).text;
}

/** An all-day event's days, inclusive ("Thu, Nov 12 · All day"). */
export function formatAllDayWhen(
  first: Temporal.PlainDate,
  last: Temporal.PlainDate,
  locale?: string
): string {
  const firstText = first.toLocaleString(locale, WHEN_DAY);
  return Temporal.PlainDate.compare(last, first) > 0
    ? `${firstText} – ${last.toLocaleString(locale, WHEN_DAY)}`
    : `${firstText} · All day`;
}

export function formatTimeRange(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  /** Defaults to the runtime's locale. */
  locale?: string
): string {
  const nights = start
    .toPlainDate()
    .until(end.toPlainDate(), { largestUnit: "days" }).days;
  const withDate = rangeShowsDates(start, end);
  const format = rangeFormat(
    locale,
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

/**
 * Hours and minutes without a trailing AM/PM ("10:25", "14:05"), for blocks
 * too narrow for the full time; the grid's hour labels give the half of day.
 */
export function formatClockTime(
  time: Temporal.ZonedDateTime,
  /** Defaults to the runtime's locale. */
  locale?: string
): string {
  return formatParts(
    rangeFormat(locale, time.timeZoneId, true, false),
    time.epochMilliseconds,
    true
  ).text;
}

/** Both ends without a trailing AM/PM ("11:30 – 12:30"), for narrow blocks. */
export function formatClockRange(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  locale?: string
): string {
  return `${formatClockTime(start, locale)} – ${formatClockTime(end, locale)}`;
}

/**
 * The 15-minute line nearest a touch, clamped to the day. Touch has no hover
 * preview, so a press on or near an hour line lands on that hour.
 */
export function nearestSlotMinutes(minutes: number, step = 15): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.max(0, Math.min(24 * 60 - step, snapped));
}
