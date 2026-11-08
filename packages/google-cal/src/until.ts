/**
 * A series' UNTIL: written so the end day's occurrence is included, read
 * back as a day, and kept in the form Google requires (a date for an
 * all-day series, a date-time for a timed one). Shared by the server and
 * both apps.
 */
import { Temporal } from "temporal-polyfill";

const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}\d{2})?$/;
const UNTIL_PART = /([:;])UNTIL=([^;]+)/;

/**
 * UNTIL for a series that ends on `day` in `timeZone`, that day's
 * occurrence included: the date itself for an all-day series, otherwise
 * the day's last second, in UTC (midnight would drop a 10 AM meeting).
 */
export function untilRuleForDay(
  day: Temporal.PlainDate,
  allDay: boolean,
  timeZone: string
): string {
  if (allDay) {
    return day.toString().replace(/-/g, "");
  }
  const instant = day
    .toZonedDateTime({ plainTime: "23:59:59", timeZone })
    .toInstant();
  return `${instant.toString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** The day an UNTIL falls on in `timeZone`. */
export function untilRuleToDay(
  until: string,
  timeZone: string
): Temporal.PlainDate | null {
  const cleaned = until.replace(/[-:]/g, "");
  const dateOnly = UNTIL_DATE.exec(cleaned);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return Temporal.PlainDate.from(`${y}-${m}-${d}`);
  }
  const full = UNTIL_DATE_TIME.exec(cleaned);
  if (!full) {
    return null;
  }
  const [, y, m, d, hh, mm, ss, offset] = full;
  const zone =
    offset && offset !== "Z" ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "Z";
  try {
    return Temporal.Instant.from(`${y}-${m}-${d}T${hh}:${mm}:${ss}${zone}`)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

/**
 * `recurrence` with its UNTIL in the form the series' start takes: a date
 * for an all-day series, a date-time (that day's last second) for a timed
 * one, as Google requires. The same array when it already is.
 */
export function matchUntilToStart(
  recurrence: string[],
  allDay: boolean,
  timeZone: string
): string[] {
  let changed = false;
  const next = recurrence.map((line) => {
    const match = line.startsWith("RRULE:") ? UNTIL_PART.exec(line) : null;
    const until = match?.[2];
    if (!(match && until) || until.includes("T") !== allDay) {
      return line;
    }
    const day = untilRuleToDay(until, timeZone);
    if (!day) {
      return line;
    }
    changed = true;
    return line.replace(
      UNTIL_PART,
      `${match[1]}UNTIL=${untilRuleForDay(day, allDay, timeZone)}`
    );
  });
  return changed ? next : recurrence;
}
