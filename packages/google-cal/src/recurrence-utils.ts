import { Temporal } from "temporal-polyfill";
import type { CreateEvent, Event } from "./schema";
import {
  parseDateList,
  type RecurrenceValue,
  readRecurrenceValue,
  untilRuleForDay,
} from "./until";
import { countedRuleDays, isRuleDay } from "./rule-days";

const COUNT_REGEX = /;?COUNT=([^;]+)/;
const COUNT_PART = /([:;])COUNT=[^;]+/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The series' rule cut to end just before the occurrence that started at
 * `originalStart` (a "2026-11-10" date for an all-day series, a date-time
 * otherwise): the day before as a date for an all-day series (UNTIL takes
 * its start's form), the second before otherwise. COUNT goes; UNTIL
 * replaces it.
 */
export function truncateRecurrenceForFollowing(
  recurrence: string[],
  originalStart: string,
  /** The series' zone, for the days of its RDATE values. */
  seriesZone = "UTC"
): string[] {
  const until = DATE_ONLY.test(originalStart)
    ? Temporal.PlainDate.from(originalStart)
        .subtract({ days: 1 })
        .toString()
        .replace(/-/g, "")
    : `${Temporal.Instant.from(originalStart)
        .subtract({ seconds: 1 })
        .toString()
        .slice(0, 19)
        .replace(/[-:]/g, "")}Z`;
  return splitAddedDays(recurrence, originalStart, seriesZone, "before").map((line) => {
    if (!line.startsWith("RRULE:")) {
      return line;
    }
    // Part by part, so a rule written COUNT-first ("RRULE:COUNT=5;...")
    // leaves no empty part behind.
    const parts = line
      .slice("RRULE:".length)
      .split(";")
      .filter(
        (part) =>
          part && !part.startsWith("COUNT=") && !part.startsWith("UNTIL=")
      );
    return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
  });
}

/**
 * The rule for a series' following part when it keeps the series' COUNT:
 * what's left of it after the `used` occurrences before the split, so a
 * five-time series split at its third doesn't run five more times.
 */
export function withRemainingCount(
  recurrence: string[],
  used: number
): string[] {
  return recurrence.map((line) => {
    const count = line.startsWith("RRULE:")
      ? Number(COUNT_REGEX.exec(line)?.[1])
      : Number.NaN;
    return Number.isFinite(count)
      ? line.replace(
          COUNT_PART,
          `$1COUNT=${Math.max(1, count - used)}`
        )
      : line;
  });
}

/** Whether a recurrence value comes before the split at `originalStart`. */
function beforeSplit(
  value: RecurrenceValue,
  originalStart: string,
  seriesZone: string
): boolean {
  if (DATE_ONLY.test(originalStart)) {
    return (
      Temporal.PlainDate.compare(value.day, Temporal.PlainDate.from(originalStart)) < 0
    );
  }
  const split = Temporal.Instant.from(originalStart);
  return value.instant
    ? Temporal.Instant.compare(value.instant, split) < 0
    : Temporal.PlainDate.compare(
        value.day,
        split.toZonedDateTimeISO(seriesZone).toPlainDate()
      ) < 0;
}

/**
 * A split series' RDATE days (added occurrences, which UNTIL doesn't cut):
 * the ones before the split stay with the old part, the rest go with the
 * new one, so none is lost or doubled.
 */
export function splitAddedDays(
  recurrence: string[],
  originalStart: string,
  seriesZone: string,
  keep: "before" | "from"
): string[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith("RDATE") ? parseDateList(line, seriesZone) : null;
    if (!list) {
      return [line];
    }
    const kept = list.values.filter((value) => {
      const read = readRecurrenceValue(value, list.zone, seriesZone);
      return read
        ? beforeSplit(read, originalStart, seriesZone) === (keep === "before")
        : true;
    });
    if (kept.length === list.values.length) {
      return [line];
    }
    return kept.length > 0
      ? [`${line.slice(0, line.lastIndexOf(":") + 1)}${kept.join(",")}`]
      : [];
  });
}

/** Whether the series adds days of its own (RDATE). */
function hasAddedDays(recurrence: string[]): boolean {
  return recurrence.some((line) => line.startsWith("RDATE"));
}

/** A Google start ("2026-11-10" or a date-time) as a recurrence value. */
function asValue(start: string, seriesZone: string): RecurrenceValue | null {
  return readRecurrenceValue(start, seriesZone, seriesZone);
}

/** A value's place in time: its moment, or its day's start (UTC). */
function order(value: RecurrenceValue): number {
  return value.instant
    ? value.instant.epochMilliseconds
    : Date.UTC(value.day.year, value.day.month - 1, value.day.day);
}

/** The values, each moment (or day) once. */
function unique(values: RecurrenceValue[]): RecurrenceValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.instant
      ? `t${value.instant.epochMilliseconds}`
      : `d${value.day.toString()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Whether an added (RDATE) value is also one of the rule's occurrences:
 * on one of its days, at the series' time (or both all day). Null when
 * the rule has parts `isRuleDay` doesn't read.
 */
function isRuleOccurrence(
  rule: string,
  start: RecurrenceValue,
  value: RecurrenceValue,
  seriesZone: string
): boolean | null {
  const onRuleDay = isRuleDay(rule, start.day, value.day);
  if (onRuleDay !== true) {
    return onRuleDay;
  }
  if (!(start.instant && value.instant)) {
    return !(start.instant || value.instant);
  }
  return Temporal.PlainTime.compare(
    start.instant.toZonedDateTimeISO(seriesZone).toPlainTime(),
    value.instant.toZonedDateTimeISO(seriesZone).toPlainTime()
  ) === 0;
}

/**
 * The added days that aren't also rule occurrences. Each is checked
 * against the rule; for a rule with parts that can't be read, COUNT says
 * how many there are (distinct days beyond it) and the latest added days
 * are taken, since added days usually run past the rule.
 */
function extraAddedDays(params: {
  added: RecurrenceValue[];
  count: number | undefined;
  distinctDays: number;
  masterRecurrence: string[];
  seriesStart: string;
  seriesZone: string;
}): RecurrenceValue[] {
  const { added, masterRecurrence, seriesZone } = params;
  const rule = masterRecurrence.find((line) => line.startsWith("RRULE:"));
  const start = asValue(params.seriesStart, seriesZone);
  const verdicts = added.map((value) =>
    rule && start ? isRuleOccurrence(rule, start, value, seriesZone) : null
  );
  if (verdicts.every((verdict) => verdict !== null)) {
    return added.filter((_, index) => !verdicts[index]);
  }
  const extras = Math.max(
    0,
    params.distinctDays - (params.count ?? params.distinctDays)
  );
  return [...added].sort((a, b) => order(b) - order(a)).slice(0, extras);
}

function sameValue(a: RecurrenceValue, b: RecurrenceValue): boolean {
  return a.instant && b.instant
    ? Temporal.Instant.compare(a.instant, b.instant) === 0
    : Temporal.PlainDate.compare(a.day, b.day) === 0;
}

/**
 * The following part of a split series' rule, with the COUNT the user
 * kept carried on. COUNT counts rule positions, EXDATE-skipped ones
 * included, while Google lists rule occurrences (skipped ones aside) and
 * RDATE-added ones, an added day that's also a rule day only once. So:
 * - with no added days, the positions used before the split are those
 *   listed before it plus the skipped days before it, and the new part
 *   runs what's left (a five-time series split at its third runs three);
 * - with added days, listed ones can't be told apart from rule ones, so
 *   the new part ends where the old series' rule did instead: UNTIL its
 *   last listed occurrence that isn't an added day.
 */
export function carryCount(
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesZone: string;
    /** Every occurrence's original start, as Google lists them. */
    starts: string[];
    /** The new part's start (it may move off the split's day or time). */
    newStart: string;
    /** The series' own first start, where its rule counts from. */
    seriesStart: string;
  }
): string[] {
  const {
    masterRecurrence,
    newStart,
    originalStart,
    seriesStart,
    seriesZone,
    starts,
  } = params;
  const listed = starts
    .map((start) => asValue(start, seriesZone))
    .filter((value): value is RecurrenceValue => value !== null);
  const listedValues = (name: "EXDATE" | "RDATE") =>
    masterRecurrence.flatMap((line) => {
      const list = parseDateList(line, seriesZone);
      return list?.name === name
        ? list.values
            .map((value) => readRecurrenceValue(value, list.zone, seriesZone))
            .filter((value): value is RecurrenceValue => value !== null)
        : [];
    });
  const exact = carryCountExactly(recurrence, params);
  if (exact) {
    return exact;
  }
  if (hasAddedDays(masterRecurrence)) {
    // The rule's last day is the latest listed one that isn't an extra
    // added day; an added day that's also a rule day stays one.
    const extraDays = extraAddedDays({
      added: unique(listedValues("RDATE")),
      count: countOf(masterRecurrence),
      distinctDays: unique([...listed, ...listedValues("EXDATE")]).length,
      masterRecurrence,
      seriesStart,
      seriesZone,
    });
    const ruleDays = listed.filter(
      (value) => !extraDays.some((day) => sameValue(day, value))
    );
    const last = ruleDays.reduce<RecurrenceValue | null>(
      (latest, value) =>
        !latest || order(value) > order(latest) ? value : latest,
      null
    );
    // The new part may start a day (or days) off the split; its last
    // occurrence is that far off the old rule's last one. UNTIL is that
    // day's end, so a later time that day still counts.
    const from = asValue(originalStart, seriesZone);
    const to = asValue(newStart, seriesZone);
    const shift = from && to ? from.day.until(to.day).days : 0;
    return last
      ? untilInstead(
          recurrence,
          untilRuleForDay(
            last.day.add({ days: shift }),
            DATE_ONLY.test(newStart),
            seriesZone
          )
        )
      : recurrence;
  }
  const before = (value: RecurrenceValue) =>
    beforeSplit(value, originalStart, seriesZone);
  // Each position once: a skipped day Google also lists (as a cancelled
  // occurrence) isn't counted twice.
  const used = unique([
    ...listed.filter(before),
    ...listedValues("EXDATE").filter(before),
  ]).length;
  return withRemainingCount(recurrence, used);
}

/**
 * The following part's rule with exactly the rule positions left: a rule
 * that can be read is walked from the series' start, its first COUNT days
 * are its positions (skipped ones included, added ones not), and the new
 * part runs the ones from the split on. Null when the rule can't be read;
 * `carryCount` then works from Google's list.
 */
export function carryCountExactly(
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesStart: string;
    seriesZone: string;
  }
): string[] | null {
  const { masterRecurrence, originalStart, seriesStart, seriesZone } = params;
  const rule = masterRecurrence.find((line) => line.startsWith("RRULE:"));
  const count = countOf(masterRecurrence);
  const seriesStartValue = asValue(seriesStart, seriesZone);
  const split = asValue(originalStart, seriesZone);
  const positions =
    rule && count !== undefined && seriesStartValue
      ? countedRuleDays(rule, seriesStartValue.day, count)
      : null;
  if (!(positions && split)) {
    return null;
  }
  // A position whose time doesn't exist that day (a 2:30 AM meeting on the
  // spring-forward night) is up to Google: count from its list instead.
  const clock = seriesStartValue?.instant
    ?.toZonedDateTimeISO(seriesZone)
    .toPlainTime();
  if (clock && positions.some((day) => !existsAt(day, clock, seriesZone))) {
    return null;
  }
  const left = positions.filter(
    (day) => Temporal.PlainDate.compare(day, split.day) >= 0
  ).length;
  return withRemainingCount(recurrence, positions.length - left);
}

/**
 * Whether `time` exists on `day` in `zone`: not in a spring-forward gap,
 * where it would come out as a later time (a repeated fall-back hour
 * exists, once or twice, and is fine).
 */
function existsAt(
  day: Temporal.PlainDate,
  time: Temporal.PlainTime,
  zone: string
): boolean {
  const zoned = day.toZonedDateTime({ plainTime: time, timeZone: zone });
  return Temporal.PlainTime.compare(zoned.toPlainTime(), time) === 0;
}

/** The rule with its COUNT swapped for `until`. */
function untilInstead(recurrence: string[], until: string): string[] {
  return recurrence.map((line) =>
    line.startsWith("RRULE:")
      ? `RRULE:${[
          ...line
            .slice("RRULE:".length)
            .split(";")
            .filter((part) => part && !part.startsWith("COUNT=")),
          `UNTIL=${until}`,
        ].join(";")}`
      : line
  );
}

/** The COUNT a series' rule ends after, if it has one. */
export function countOf(recurrence: string[] | undefined): number | undefined {
  for (const line of recurrence ?? []) {
    const count = line.startsWith("RRULE:")
      ? Number(COUNT_REGEX.exec(line)?.[1])
      : Number.NaN;
    if (Number.isFinite(count)) {
      return count;
    }
  }
}

// Strip server-managed fields so create/update inputs stay valid.
export function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}
