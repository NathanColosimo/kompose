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
  if (!meetsOnceADay(rule)) {
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

/** A slot of a series: a moment, or a date when it's all day. */
type Slot = Temporal.PlainDate | Temporal.Instant;

/** `slot` as the library reads it: a date at UTC midnight, a moment in the series' zone. */
function asLibraryTime(
  slot: Slot,
  first: Temporal.PlainDate | Temporal.ZonedDateTime
): Temporal.ZonedDateTime {
  if (slot instanceof Temporal.PlainDate) {
    return slot.toZonedDateTime({ timeZone: "UTC" });
  }
  return slot.toZonedDateTimeISO(
    first instanceof Temporal.ZonedDateTime ? first.timeZoneId : "UTC"
  );
}

/** A meeting the library gives back, in the series' form. */
function fromLibrary(
  meeting: Temporal.ZonedDateTime,
  first: Temporal.PlainDate | Temporal.ZonedDateTime
): Slot {
  return first instanceof Temporal.PlainDate
    ? meeting.toPlainDate()
    : meeting.toInstant();
}

/**
 * `rule`'s meetings from `from` through `to`, as a series starting at
 * `first` repeats it (its start is a meeting). Null when the rule can't be
 * read.
 */
export function ruleMeetings(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  from: Slot;
  rule: string;
  to: Slot;
}): Slot[] | null {
  const { first } = params;
  const rule = expand(params.rule, first, true);
  return rule
    ? rule
        .between(
          asLibraryTime(params.from, first),
          asLibraryTime(params.to, first),
          true
        )
        .map((meeting) => fromLibrary(meeting, first))
    : null;
}

/**
 * Whether `rule`, repeating from the series' start (`first`), has no
 * meeting at or after `split`: its COUNT or UNTIL ran out before. Null
 * when the rule can't be read.
 */
export function ruleEndsBefore(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
  split: Slot;
}): boolean | null {
  const { first } = params;
  const rule = expand(params.rule, first, true);
  return rule
    ? rule.next(asLibraryTime(params.split, first), true) === null
    : null;
}

/**
 * The moment (a date, all day) `rule`'s UNTIL names, read against a series
 * starting at `first`; null when it has none or can't be read.
 */
export function ruleUntil(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
}): Slot | null {
  const until = expand(params.rule, params.first, true)?.options().until;
  return until ? fromLibrary(until, params.first) : null;
}

/**
 * How many of a COUNT `rule`'s positions are at or after `split`, for a
 * series starting at `first`: its meetings, skipped ones too, the start
 * counted as the first (RFC 5545, as Google counts them). Null when the
 * rule can't be read, or when the clocks skip its time on a day before
 * the split: RFC 5545 drops that meeting, and whether Google does isn't
 * known, so how many are left can't be told.
 */
export function positionsLeft(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
  split: Slot;
}): number | null {
  const { first, rule, split } = params;
  const at = asLibraryTime(split, first);
  try {
    const positions = expand(rule, first, true)?.all();
    if (!positions) {
      return null;
    }
    const before = positions.filter(
      (position) => Temporal.ZonedDateTime.compare(position, at) < 0
    ).length;
    // A timed rule meeting once a day has a position on each of its days
    // unless the clocks skip its time there.
    if (first instanceof Temporal.ZonedDateTime && meetsOnceADay(rule)) {
      const day = at.toPlainDate();
      const daysBefore = (expand(rule, first.toPlainDate(), true)?.all() ?? [])
        .map((position) => position.toPlainDate())
        .filter((position) => Temporal.PlainDate.compare(position, day) < 0);
      if (daysBefore.length !== before) {
        return null;
      }
    }
    return positions.length - before;
  } catch {
    // The library gives up on a rule too long to expand.
    return null;
  }
}

/** Whether `rule` repeats daily or less often: once a day, as Google reads it. */
function meetsOnceADay(rule: string): boolean {
  return rule
    .replace("RRULE:", "")
    .split(";")
    .some((part) => DAILY_OR_LONGER.test(part));
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
