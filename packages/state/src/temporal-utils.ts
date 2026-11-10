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
    const day = startDay.toLocaleString(locale, WHEN_DAY);
    // Midnight to midnight is the whole day (formatTimeRange would add
    // dates for a 24-hour range).
    return rangeShowsDates(start, end)
      ? `${day} · All day`
      : `${day} · ${formatTimeRange(start, end, locale)}`;
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
  return time.toLocaleString(locale, {
    hour: "numeric",
    minute: time.minute === 0 ? undefined : "2-digit",
  });
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

/**
 * A compact time range in the locale's style, shared by web and mobile:
 * "10 AM – 12 PM" on the hour, "9:00 – 9:30 AM" within one half of the day,
 * times only for an overnight range ("11 PM – 7 AM"), and dates once the
 * range lasts a day or more ("Nov 6, 9 AM – Nov 8, 5 PM").
 */
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
  const format = new Intl.DateTimeFormat(locale, {
    day: withDate ? "numeric" : undefined,
    month: withDate ? "short" : undefined,
    hour: "numeric",
    minute: start.minute === 0 && end.minute === 0 ? undefined : "2-digit",
    timeZone: start.timeZoneId,
  });
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
    new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: time.timeZoneId,
    }),
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

/**
 * "Today" or "Tomorrow" in the locale's words. Hermes (the iOS and Android
 * JS engine) has no Intl.RelativeTimeFormat, so it falls back to English
 * there rather than crashing the list.
 */
function relativeDayWord(daysAway: 0 | 1, locale?: string): string {
  if (typeof Intl.RelativeTimeFormat !== "function") {
    return daysAway === 0 ? "Today" : "Tomorrow";
  }
  const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    daysAway,
    "day"
  );
  return `${word.charAt(0).toLocaleUpperCase(locale)}${word.slice(1)}`;
}

/**
 * When a scheduled task starts, for a list: "Today" or "Tomorrow", the
 * weekday within the coming week ("Sat 10:00 AM"), else the date ("Nov 21,
 * 10:00 AM"), so tasks a week apart never read the same.
 */
export function formatScheduledAt(
  time: Temporal.ZonedDateTime,
  today: Temporal.PlainDate,
  locale?: string
): string {
  const date = time.toPlainDate();
  const daysAway = today.until(date, { largestUnit: "days" }).days;
  // Composed from parts: ICU versions join date and time differently
  // ("Nov 21, 10:00 AM" or "Nov 21 at 10:00 AM").
  const clock = time.toLocaleString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (daysAway === 0 || daysAway === 1) {
    return `${relativeDayWord(daysAway, locale)} ${clock}`;
  }
  if (daysAway > 1 && daysAway < 7) {
    return `${date.toLocaleString(locale, { weekday: "short" })} ${clock}`;
  }
  const day = date.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    ...(date.year === today.year ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock}`;
}

interface EventRange {
  /**
   * The range's ends as moments, which its clock fields can't always tell:
   * in the hour a clock change repeats, 1:30 happens twice.
   * `moveEventStart` returns them given a zone, and reads them back while
   * they still match the clock fields.
   */
  end?: Temporal.ZonedDateTime;
  endDate: Temporal.PlainDate;
  endTime: Temporal.PlainTime | null;
  start?: Temporal.ZonedDateTime;
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
}

/** Move the start while preserving the event's duration or all-day span. */
export function moveEventStart(
  range: EventRange,
  next: { date?: Temporal.PlainDate; time?: Temporal.PlainTime },
  timeZone = "UTC"
): EventRange {
  const startDate = next.date ?? range.startDate;
  const startTime = next.time ?? range.startTime;
  if (!startTime) {
    const days = Math.max(
      0,
      range.startDate.until(range.endDate, { largestUnit: "days" }).days
    );
    return {
      startDate,
      startTime: null,
      endDate: startDate.add({ days }),
      endTime: null,
    };
  }
  // Clock fields alone cannot distinguish the two halves of a repeated DST hour.
  const at = (
    date: Temporal.PlainDate,
    time: Temporal.PlainTime,
    moment?: Temporal.ZonedDateTime
  ) =>
    moment?.timeZoneId === timeZone &&
    moment.toPlainDateTime().equals(date.toPlainDateTime(time))
      ? moment
      : date.toZonedDateTime({ plainTime: time, timeZone });
  const oldStart = at(
    range.startDate,
    range.startTime ?? startTime,
    range.start
  );
  let duration = Temporal.Duration.from({ minutes: 30 });
  if (range.endTime) {
    const oldEnd = at(range.endDate, range.endTime, range.end);
    const previousDuration = oldStart.until(oldEnd, { largestUnit: "hours" });
    if (previousDuration.sign >= 0) {
      duration = previousDuration;
    }
  }
  const start = at(startDate, startTime, oldStart);
  const end = start.add(duration);
  return {
    start,
    end,
    startDate: start.toPlainDate(),
    startTime: start.toPlainTime(),
    endDate: end.toPlainDate(),
    endTime: end.toPlainTime(),
  };
}
