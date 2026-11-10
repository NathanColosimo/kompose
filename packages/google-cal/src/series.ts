/**
 * A series' rules expanded as Google reads them (RFC 5545, by
 * `rrule-temporal`). The only module that touches the library.
 */
import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";

/** RFC 5545 weekday codes, Monday first (Temporal's `dayOfWeek` - 1). */
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** A rule part that ends it: COUNT or UNTIL. */
const END_PART = /^(?:COUNT|UNTIL)=/;

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

/** A rule read once, for many questions about its meetings. */
export interface RuleReader {
  /** Its meetings from `from` through `to`. */
  meetingsBetween: (from: Slot, to: Slot) => Slot[];
  /**
   * Whether it has a meeting at `slot`, before its end: a moment, or a
   * date (any meeting that day).
   */
  meetsAt: (slot: Slot) => boolean;
}

/** The rules read last (`readRule`), by start and rule, oldest first. */
const readRules = new Map<string, RuleReader | null>();
const READ_RULES_KEPT = 16;

/**
 * `rule`, repeating from the series' start (`first`), read once: the start
 * is always a meeting (Google meets at it, rule or not). Asking about it
 * many times stays cheap, and the last few rules read are kept, since one
 * save asks about the same rule once for each skip and changed meeting.
 * Null when the rule can't be read.
 */
export function readRule(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
}): RuleReader | null {
  const key = `${dtstartLine(params.first)}\n${params.rule}`;
  const kept = readRules.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const reader = newReader(params);
  const oldest = readRules.keys().next();
  if (readRules.size >= READ_RULES_KEPT && !oldest.done) {
    readRules.delete(oldest.value);
  }
  readRules.set(key, reader);
  return reader;
}

function newReader(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
}): RuleReader | null {
  const { first } = params;
  const rule = expand(params.rule, first, true);
  if (!rule) {
    return null;
  }
  const between = (from: Slot, to: Slot) =>
    rule
      .between(asLibraryTime(from, first), asLibraryTime(to, first), true)
      .map((meeting) => fromLibrary(meeting, first));
  const meets = (slot: Slot) =>
    slot instanceof Temporal.PlainDate
      ? rule.occursOn(slot)
      : first instanceof Temporal.ZonedDateTime &&
        rule.matches(slot.toZonedDateTimeISO(first.timeZoneId));
  // A rule with an end, asked more than once, is expanded once: the
  // library walks it from its start for each question. One too long to
  // expand is asked directly.
  let asked = 0;
  let expanded:
    | { all: Temporal.ZonedDateTime[]; days: Set<string>; moments: Set<number> }
    | null
    | undefined;
  const meetings = () => {
    asked += 1;
    if (asked < 2 || endless(params.rule) === params.rule) {
      return null;
    }
    if (expanded === undefined) {
      try {
        const all = rule.all();
        expanded = {
          all,
          days: new Set(all.map((meeting) => meeting.toPlainDate().toString())),
          moments: new Set(all.map((meeting) => meeting.epochMilliseconds)),
        };
      } catch {
        expanded = null;
      }
    }
    return expanded;
  };
  return {
    meetingsBetween: (from, to) => {
      const known = meetings();
      if (!known) {
        return between(from, to);
      }
      const lo = asLibraryTime(from, first).epochMilliseconds;
      const hi = asLibraryTime(to, first).epochMilliseconds;
      return known.all
        .filter(
          (meeting) =>
            meeting.epochMilliseconds >= lo && meeting.epochMilliseconds <= hi
        )
        .map((meeting) => fromLibrary(meeting, first));
    },
    meetsAt: (slot) => {
      const known = meetings();
      if (!known) {
        return meets(slot);
      }
      return slot instanceof Temporal.PlainDate
        ? known.days.has(slot.toString())
        : first instanceof Temporal.ZonedDateTime &&
            known.moments.has(slot.epochMilliseconds);
    },
  };
}

/**
 * Whether `rule`, repeating from the series' start (`first`), has a
 * meeting at `slot`, before its end (`readRule`). Null when the rule can't
 * be read.
 */
export function ruleMeetsAt(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
  slot: Slot;
}): boolean | null {
  return readRule(params)?.meetsAt(params.slot) ?? null;
}

/**
 * `rule`'s meetings from `from` through `to`, as a series starting at
 * `first` repeats it (`readRule`). Null when the rule can't be read.
 */
export function ruleMeetings(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  from: Slot;
  rule: string;
  to: Slot;
}): Slot[] | null {
  return readRule(params)?.meetingsBetween(params.from, params.to) ?? null;
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
 * A COUNT `rule`'s positions, for a series starting at `first`: its
 * meetings, skipped ones too, the start counted as the first (RFC 5545,
 * as Google counts them), how many (`count`) and how many come before
 * `split` (`before`). With the days before the split whose position the
 * clocks skip (`skippedTimeDays`, a timed rule meeting once a day): RFC
 * 5545 drops that meeting, and whether Google does isn't known, so
 * `before` can't be trusted when there are any. Null when the rule can't
 * be read.
 */
export function rulePositions(params: {
  first: Temporal.PlainDate | Temporal.ZonedDateTime;
  rule: string;
  split: Slot;
}): {
  before: number;
  count: number;
  skippedTimeDays: Temporal.PlainDate[];
} | null {
  const { first, rule } = params;
  const split = asLibraryTime(params.split, first);
  try {
    const positions = expand(rule, first, true)?.all();
    if (!positions) {
      return null;
    }
    const before = positions.filter(
      (position) => Temporal.ZonedDateTime.compare(position, split) < 0
    );
    // A timed rule meeting once a day has a position on each of its days
    // unless the clocks skip its time there.
    const days =
      first instanceof Temporal.ZonedDateTime && meetsOnceADay(rule)
        ? (expand(rule, first.toPlainDate(), true)?.all() ?? [])
        : [];
    const skippedTimeDays = days
      .map((day) => day.toPlainDate())
      .filter(
        (day) =>
          Temporal.PlainDate.compare(day, split.toPlainDate()) < 0 &&
          !before.some((position) => position.toPlainDate().equals(day))
      );
    return { before: before.length, count: positions.length, skippedTimeDays };
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
 * `rule` without its end (COUNT or UNTIL): its days alone. An UNTIL with
 * a time can't end a rule read by date (RFC 5545 has it take DTSTART's
 * form), and these questions are about the days.
 */
function endless(rule: string): string {
  // Read past "RRULE:": an UNTIL may be written first.
  const body = rule.indexOf(":") + 1;
  return `${rule.slice(0, body)}${rule
    .slice(body)
    .split(";")
    .filter((part) => !END_PART.test(part))
    .join(";")}`;
}

/**
 * How many days `rule` meets on from `from` through `through`, as a series
 * starting on `from` (which counts only if the rule meets on it), its end
 * left out. Null when the rule can't be read.
 */
export function ruleDayCount(params: {
  from: Temporal.PlainDate;
  rule: string;
  through: Temporal.PlainDate;
}): number | null {
  const rule = expand(endless(params.rule), params.from, false);
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
export function meetsSeveralTimesADay(params: {
  first: Temporal.ZonedDateTime;
  recurrence: string[];
}): boolean {
  const { first } = params;
  const clocks = new Set([first.toPlainTime().toString()]);
  for (const rule of params.recurrence.filter((line) =>
    line.startsWith("RRULE:")
  )) {
    for (const meeting of expand(rule, first, true)?.all((_, i) => i < 3) ??
      []) {
      clocks.add(meeting.toPlainTime().toString());
    }
  }
  return clocks.size > 1;
}

/**
 * Whether `day` is one of `rule`'s days, repeating from the series'
 * `start` day, as Google reads it: its time and its end left out. Null
 * when the rule can't be read.
 */
export function isRuleDay(
  rule: string,
  start: Temporal.PlainDate,
  day: Temporal.PlainDate
): boolean | null {
  try {
    return expand(endless(rule), start, false)?.occursOn(day) ?? null;
  } catch {
    return null;
  }
}
