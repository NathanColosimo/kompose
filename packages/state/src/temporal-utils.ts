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

/**
 * An event's range after its start moves: it keeps its length, so a 2-hour
 * meeting moved to 3 PM ends at 5 PM, onto the next day when that crosses
 * midnight. An all-day event keeps its day span. Given the zone its times
 * are in, the length is real time, so a meeting over a clock change keeps
 * its hours (a 0:30-2:30 meeting on the night the clocks go back is three
 * hours), and the result carries its ends as moments (`start`, `end`): a
 * clock time alone can't say which of a repeated hour's halves it's in.
 * Without a zone, the length is the clock's. A zero-length event stays
 * zero; with no length to keep (no end, or an end before the start), it
 * gets 30 minutes.
 */
export function moveEventStart(
  range: EventRange,
  next: { date?: Temporal.PlainDate; time?: Temporal.PlainTime },
  timeZone?: string
): EventRange {
  const startDate = next.date ?? range.startDate;
  const startTime = next.time ?? range.startTime;
  if (!startTime) {
    const days = Math.max(
      0,
      range.startDate.until(range.endDate, { largestUnit: "days" }).days
    );
    // An all-day range has no moments to carry.
    return {
      endDate: startDate.add({ days }),
      endTime: range.endTime,
      startDate,
      startTime: range.startTime,
    };
  }
  const oldTime = range.startTime ?? startTime;
  if (!timeZone) {
    const end = keptLength(
      (date, time) => date.toPlainDateTime(time),
      range,
      oldTime,
      { date: startDate, time: startTime }
    );
    return {
      endDate: end.toPlainDate(),
      endTime: end.toPlainTime(),
      startDate,
      startTime,
    };
  }
  const zoned = (date: Temporal.PlainDate, time: Temporal.PlainTime) =>
    date.toZonedDateTime({ plainTime: time, timeZone });
  const moments = momentsOf(range, timeZone);
  // A start left where it was keeps its moment (in a repeated hour, its
  // half); a new one is read in the zone, a time the clocks skip landing
  // after the gap.
  const start =
    moments &&
    startDate.equals(range.startDate) &&
    range.startTime &&
    startTime.equals(range.startTime)
      ? moments.start
      : zoned(startDate, startTime);
  const end = moments
    ? start.add(withLength(moments.start.until(moments.end, LENGTH)))
    : keptLength(zoned, range, oldTime, { date: startDate, time: startTime });
  return {
    end,
    endDate: end.toPlainDate(),
    endTime: end.toPlainTime(),
    start,
    startDate: start.toPlainDate(),
    startTime: start.toPlainTime(),
  };
}

const LENGTH = { largestUnit: "hours" } as const;

/** `length`, or 30 minutes when it's negative (an end before the start). */
function withLength(length: Temporal.Duration): Temporal.DurationLike {
  return length.sign >= 0 ? length : { minutes: 30 };
}

/**
 * The range's moments, while they're still its clock fields in `timeZone`
 * (a form edited since has only its clock fields to go by).
 */
function momentsOf(
  range: EventRange,
  timeZone: string
): { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime } | null {
  const { end, start } = range;
  const matches = (
    moment: Temporal.ZonedDateTime | undefined,
    date: Temporal.PlainDate,
    time: Temporal.PlainTime | null
  ) =>
    Boolean(
      moment &&
        time &&
        moment.timeZoneId === timeZone &&
        moment.toPlainDate().equals(date) &&
        moment.toPlainTime().equals(time)
    );
  return start &&
    end &&
    matches(start, range.startDate, range.startTime) &&
    matches(end, range.endDate, range.endTime)
    ? { end, start }
    : null;
}

/** A moment a range's ends can be read as: on the clock, or in a zone. */
interface RangeMoment<T> {
  add: (duration: Temporal.Duration | Temporal.DurationLike) => T;
  toPlainDate: () => Temporal.PlainDate;
  toPlainTime: () => Temporal.PlainTime;
  until: (other: T, options: typeof LENGTH) => Temporal.Duration;
}

/**
 * The end of `range` moved to start at `next`, read through `at`: its
 * length kept, zero included, or 30 minutes with none to keep.
 */
function keptLength<T extends RangeMoment<T>>(
  at: (date: Temporal.PlainDate, time: Temporal.PlainTime) => T,
  range: EventRange,
  startTime: Temporal.PlainTime,
  next: { date: Temporal.PlainDate; time: Temporal.PlainTime }
): T {
  const start = at(next.date, next.time);
  return range.endTime
    ? start.add(
        withLength(
          at(range.startDate, startTime).until(
            at(range.endDate, range.endTime),
            LENGTH
          )
        )
      )
    : start.add({ minutes: 30 });
}
