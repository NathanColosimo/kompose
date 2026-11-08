import { Temporal } from "temporal-polyfill";
import type { CreateEvent, Event } from "./schema";
import {
  parseDateList,
  type RecurrenceValue,
  readRecurrenceValue,
} from "./until";

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

/**
 * How many of a split series' rule positions its listed occurrences before
 * the split stand for: Google lists rule occurrences (EXDATE-skipped ones
 * aside) and RDATE-added ones, while COUNT counts rule positions, skipped
 * ones included. So: listed, less RDATE days before, plus EXDATE days.
 */
export function rulePositionsBefore(
  listed: number,
  recurrence: string[],
  originalStart: string,
  seriesZone: string
): number {
  let added = 0;
  let skipped = 0;
  for (const line of recurrence) {
    const list = parseDateList(line, seriesZone);
    if (!list) {
      continue;
    }
    const before = list.values.filter((value) => {
      const read = readRecurrenceValue(value, list.zone, seriesZone);
      return read ? beforeSplit(read, originalStart, seriesZone) : false;
    }).length;
    if (list.name === "RDATE") {
      added += before;
    } else {
      skipped += before;
    }
  }
  return Math.max(0, listed - added + skipped);
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
