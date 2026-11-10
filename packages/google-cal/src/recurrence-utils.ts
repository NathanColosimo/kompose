import { Temporal } from "temporal-polyfill";
import type { CreateEvent, Event } from "./schema";
import { ruleEndsBefore, ruleMeetsAt, ruleUntil } from "./series";
import type { SeriesRefusal } from "./series-edits";
import {
  DATE_ONLY,
  dateValues,
  keepingDateValues,
  type RecurrenceValue,
  readRecurrenceValue,
} from "./until";

/**
 * The series' rules cut to end just before the occurrence at
 * `originalStart` (the second before it, or the day before all day). UNTIL
 * replaces COUNT; a rule that already ended keeps its end, as a cut never
 * lengthens it. Each part keeps its own added days (UNTIL doesn't cut
 * them). A cut at or before the series' own start (meetings added before
 * it) skips that start too: Google keeps a series' start whatever its rule
 * says.
 */
export function truncateRecurrenceForFollowing(params: {
  originalStart: string;
  recurrence: string[];
  /** The series' first start, where its rules count from. */
  seriesStart: { date?: string | null; dateTime?: string | null };
  seriesZone: string;
}): string[] {
  const { originalStart, recurrence, seriesZone } = params;
  const split = asValue(originalStart, seriesZone);
  const first = asValue(
    params.seriesStart.dateTime ?? params.seriesStart.date ?? "",
    seriesZone
  );
  if (!(split && first)) {
    return recurrence;
  }
  const until = split.instant
    ? split.instant
        .subtract({ seconds: 1 })
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")
    : split.day.subtract({ days: 1 }).toString().replace(/-/g, "");
  const ended = (rule: string) =>
    ruleEndsBefore({
      first: libraryFirst(first, seriesZone),
      rule,
      split: split.instant ?? split.day,
    }) === true;
  const cut = splitAddedDays(
    recurrence,
    originalStart,
    seriesZone,
    "before"
  ).map((line) => {
    if (!isRule(line) || ended(line)) {
      return line;
    }
    // Part by part, so "RRULE:COUNT=5;..." leaves no empty part behind.
    const parts = line
      .slice("RRULE:".length)
      .split(";")
      .filter(
        (part) =>
          part && !part.startsWith("COUNT=") && !part.startsWith("UNTIL=")
      );
    return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
  });
  const atOrBeforeStart = !beforeSplit(first, originalStart, seriesZone);
  return atOrBeforeStart
    ? skipping(
        cut,
        [first.instant?.toString() ?? first.day.toString()],
        seriesZone
      )
    : cut;
}

/** A series' start as the library reads it: a date, or a zoned time. */
function libraryFirst(
  first: RecurrenceValue,
  seriesZone: string
): Temporal.PlainDate | Temporal.ZonedDateTime {
  return first.instant?.toZonedDateTimeISO(seriesZone) ?? first.day;
}

/** Whether a recurrence value comes before the split at `originalStart`. */
function beforeSplit(
  value: RecurrenceValue,
  originalStart: string,
  seriesZone: string
): boolean {
  const split = asValue(originalStart, seriesZone);
  if (!split) {
    return false;
  }
  return value.instant && split.instant
    ? Temporal.Instant.compare(value.instant, split.instant) < 0
    : Temporal.PlainDate.compare(value.day, split.day) < 0;
}

/**
 * The recurrence keeping only the RDATE days on one side of the split
 * (`keep`). UNTIL doesn't cut added days, so each part takes its own.
 */
export function splitAddedDays(
  recurrence: string[],
  originalStart: string,
  seriesZone: string,
  keep: "before" | "from"
): string[] {
  return keepingDateValues(
    recurrence,
    "RDATE",
    seriesZone,
    (value) =>
      beforeSplit(value, originalStart, seriesZone) === (keep === "before")
  );
}

/**
 * Whether a new series' rule ends (UNTIL) before `start`, its first
 * meeting: Google would keep only that meeting.
 */
export function endsBeforeStart(
  recurrence: string[],
  start: { date?: string | null; dateTime?: string | null },
  seriesZone: string
): boolean {
  const first = asValue(start.dateTime ?? start.date ?? "", seriesZone);
  const rule = recurrence.find(isRule);
  if (!(first && rule)) {
    return false;
  }
  const until = ruleUntil({ first: libraryFirst(first, seriesZone), rule });
  if (!until) {
    return false;
  }
  return until instanceof Temporal.Instant
    ? Boolean(
        first.instant && Temporal.Instant.compare(until, first.instant) < 0
      )
    : Temporal.PlainDate.compare(until, first.day) < 0;
}

/**
 * Whether `slot` (an original start) is an added (RDATE) meeting. It may be
 * a rule meeting too; the caller decides whose it is.
 */
export function addsSlot(
  recurrence: string[],
  slot: string,
  seriesZone: string
): boolean {
  const value = asValue(slot, seriesZone);
  return Boolean(
    value &&
      dateValues(recurrence, "RDATE", seriesZone).some((added) =>
        sameValue(added, value)
      )
  );
}

/** A This and following split of a series, as the helpers below read it. */
interface FollowingSplit {
  masterRecurrence: string[] | null | undefined;
  masterStart: { date?: string | null; dateTime?: string | null };
  originalStart: string;
  seriesZone: string;
}

/**
 * Whether "This and following" from `originalStart` is the whole series:
 * nothing of it comes before (it's at or before the series' start, with
 * no meeting added before it).
 */
export function followingIsWhole(params: FollowingSplit): boolean {
  const { originalStart, seriesZone } = params;
  const first = asValue(
    params.masterStart.dateTime ?? params.masterStart.date ?? "",
    seriesZone
  );
  return Boolean(
    first &&
      !beforeSplit(first, originalStart, seriesZone) &&
      !dateValues(params.masterRecurrence ?? [], "RDATE", seriesZone).some(
        (added) => beforeSplit(added, originalStart, seriesZone)
      )
  );
}

/**
 * Why "This and following" can't start a new series at `originalStart`;
 * null when it can. A new series repeats from its start, so that start
 * must be a rule meeting. Several rules (an EXRULE counts; only other apps
 * write them) can't keep each one's days and phase from one start, nor
 * can an added (RDATE) meeting that isn't a rule meeting too.
 */
export function followingSplitBlocked(
  params: FollowingSplit
): Extract<SeriesRefusal["reason"], "addedOccurrence" | "severalRules"> | null {
  const { originalStart, seriesZone } = params;
  const recurrence = params.masterRecurrence ?? [];
  const rules = recurrence.filter(
    (line) => isRule(line) || line.startsWith("EXRULE")
  );
  if (rules.length > 1) {
    return "severalRules";
  }
  // The series' own start is its rule's anchor, added there too or not.
  const ruleMeets =
    seriesMeetsAt({
      recurrence: rules,
      seriesZone,
      slot: originalStart,
      start: params.masterStart,
    }) === true;
  return addsSlot(recurrence, originalStart, seriesZone) && !ruleMeets
    ? "addedOccurrence"
    : null;
}

/** A Google start ("2026-11-10" or a date-time) as a recurrence value. */
function asValue(start: string, seriesZone: string): RecurrenceValue | null {
  return readRecurrenceValue(start, seriesZone, seriesZone);
}

/** Whether `recurrence` repeats at all: a rule, or an added day. */
export function repeats(recurrence: string[] | undefined): boolean {
  return (recurrence ?? []).some(
    (line) => line.startsWith("RRULE:") || line.startsWith("RDATE")
  );
}

/** A skip's key: its moment, or its date for an all-day one. */
export function skipKey(value: RecurrenceValue): string {
  return value.instant
    ? String(value.instant.epochMilliseconds)
    : value.day.toString();
}

/**
 * `recurrence` with the occurrences at `starts` (original starts) skipped,
 * each once: a skip it already has isn't written again. Unchanged when it
 * doesn't repeat.
 */
export function skipping(
  recurrence: string[],
  starts: string[],
  zone: string
): string[] {
  if (starts.length === 0 || !repeats(recurrence)) {
    return recurrence;
  }
  const skipped = new Set(dateValues(recurrence, "EXDATE", zone).map(skipKey));
  // Each skip once, however many times it's asked for.
  const fresh = starts.filter((start) => {
    const value = asValue(start, zone);
    if (!value || skipped.has(skipKey(value))) {
      return !value;
    }
    skipped.add(skipKey(value));
    return true;
  });
  if (fresh.length === 0) {
    return recurrence;
  }
  const dates = fresh
    .filter((start) => DATE_ONLY.test(start))
    .map((start) => start.replace(/-/g, ""));
  const times = fresh
    .filter((start) => !DATE_ONLY.test(start))
    .map((start) =>
      Temporal.Instant.from(start)
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")
    );
  return [
    ...recurrence,
    ...(dates.length > 0 ? [`EXDATE;VALUE=DATE:${dates.join(",")}`] : []),
    ...(times.length > 0 ? [`EXDATE:${times.join(",")}`] : []),
  ];
}

function sameValue(a: RecurrenceValue, b: RecurrenceValue): boolean {
  return a.instant && b.instant
    ? Temporal.Instant.compare(a.instant, b.instant) === 0
    : Temporal.PlainDate.compare(a.day, b.day) === 0;
}

/**
 * Whether the series has a meeting at `slot` (an original start): its
 * start, an added (RDATE) meeting, or a rule's, less EXDATE skips. Google
 * keeps an occurrence's own changes only while the series still has its
 * original slot. Null when that can't be told: an exclusion rule (EXRULE)
 * isn't read.
 */
export function seriesMeetsAt(params: {
  recurrence: string[];
  seriesZone: string;
  slot: string;
  start: { date?: string | null; dateTime?: string | null };
}): boolean | null {
  const { recurrence, seriesZone } = params;
  const first = asValue(
    params.start.dateTime ?? params.start.date ?? "",
    seriesZone
  );
  const slot = asValue(params.slot, seriesZone);
  if (!(first && slot)) {
    return null;
  }
  // Every meeting takes the start's form (a date, or a date-time).
  if (Boolean(first.instant) !== Boolean(slot.instant)) {
    return false;
  }
  if (recurrence.some((line) => line.startsWith("EXRULE"))) {
    return null;
  }
  const at = (values: RecurrenceValue[]) =>
    values.some((value) => sameValue(value, slot));
  if (at(dateValues(recurrence, "EXDATE", seriesZone))) {
    return false;
  }
  if (
    sameValue(first, slot) ||
    at(dateValues(recurrence, "RDATE", seriesZone))
  ) {
    return true;
  }
  const meets = recurrence.filter(isRule).map((rule) =>
    ruleMeetsAt({
      first: first.instant?.toZonedDateTimeISO(seriesZone) ?? first.day,
      rule,
      slot: slot.instant ?? slot.day,
    })
  );
  if (meets.includes(true)) {
    return true;
  }
  return meets.includes(null) ? null : false;
}

const isRule = (line: string) => line.startsWith("RRULE:");

// Strip server-managed fields so create/update inputs stay valid.
export function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    // A new event can't reuse it; an update doesn't need it.
    iCalUID: _iCalUID,
    htmlLink: _htmlLink,
    organizer: _organizer,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    ...rest
  } = event;
  return rest;
}
