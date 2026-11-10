/**
 * A series' rules expanded as Google reads them (RFC 5545, by
 * `rrule-temporal`). The only module that touches the library.
 */
import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";

const DAILY_OR_LONGER = /^FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)$/;
const TIME_PART = /^BY(?:HOUR|MINUTE|SECOND)=/;

/**
 * `rule`'s parts as Google reads them: it meets a day-or-longer rule once
 * a day, at the start's time or a time part's one value, and ignores a
 * list there. Without `times`, no time parts at all (days only).
 */
function googleParts(rule: string, times: boolean): string {
  const parts = rule.replace("RRULE:", "").split(";").filter(Boolean);
  if (!parts.some((part) => DAILY_OR_LONGER.test(part))) {
    return parts.join(";");
  }
  return parts
    .filter((part) => !(TIME_PART.test(part) && (!times || part.includes(","))))
    .join(";");
}

/** A DTSTART line: a date (all day, read in UTC by the library) or a zoned time. */
function dtstartLine(dtstart: Temporal.PlainDate | Temporal.ZonedDateTime) {
  return dtstart instanceof Temporal.PlainDate
    ? `DTSTART;VALUE=DATE:${dtstart.toString().replaceAll("-", "")}`
    : `DTSTART;TZID=${dtstart.timeZoneId}:${dtstart
        .toPlainDateTime()
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")}`;
}

/** `rule` expanded from `dtstart`; null when the library can't read it. */
function expand(
  rule: string,
  dtstart: Temporal.PlainDate | Temporal.ZonedDateTime,
  includeDtstart: boolean
): RRuleTemporal<Temporal.ZonedDateTime> | null {
  try {
    return new RRuleTemporal({
      includeDtstart,
      rruleString: `${dtstartLine(dtstart)}\nRRULE:${googleParts(rule, dtstart instanceof Temporal.ZonedDateTime)}`,
      temporal: Temporal,
    });
  } catch {
    return null;
  }
}

/**
 * Whether `rule`, repeating from the series' start (`first`), has a
 * meeting at `slot`, before its end: a moment, or a date when all day.
 * The start is always a meeting (Google meets at it, rule or not). Null
 * when the rule can't be read.
 */
export function ruleMeetsAt(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
  slot: Temporal.PlainDate | Temporal.Instant;
}): boolean | null {
  const { first, slot } = params;
  const rule = expand(params.rule, first, true);
  if (!rule) {
    return null;
  }
  return slot instanceof Temporal.PlainDate
    ? rule.occursOn(slot)
    : first instanceof Temporal.ZonedDateTime &&
        rule.matches(slot.toZonedDateTimeISO(first.timeZoneId));
}

/**
 * How many days `rule` meets on from `from` through `through`, as a series
 * starting on `from` (which counts only if the rule meets on it). Null
 * when the rule can't be read.
 */
export function ruleDayCount(params: {
  from: Temporal.PlainDate;
  rule: string;
  through: Temporal.PlainDate;
}): number | null {
  const rule = expand(params.rule, params.from, false);
  const utc = (day: Temporal.PlainDate) =>
    day.toZonedDateTime({ timeZone: "UTC" });
  return rule
    ? rule.between(utc(params.from), utc(params.through), true).length
    : null;
}

/**
 * Whether a series meets at more than one time of day: a rule that steps
 * within a day, or meets at a time other than its start's (`first`), as
 * its first meetings show. Such a series' times don't follow its start.
 */
export function meetsSeveralTimesADay(
  recurrence: string[],
  first: Temporal.ZonedDateTime
): boolean {
  const clocks = new Set([first.toPlainTime().toString()]);
  for (const rule of recurrence.filter((line) => line.startsWith("RRULE:"))) {
    for (const meeting of expand(rule, first, true)?.all((_, i) => i < 3) ??
      []) {
      clocks.add(meeting.toPlainTime().toString());
    }
  }
  return clocks.size > 1;
}
