/**
 * What a write to a repeating series keeps and changes, worked out before
 * anything is written: the fields an edit really changed, the times and
 * fields an occurrence changed on its own (Google keeps those as
 * exceptions, tied to the occurrence's original slot), where such an
 * occurrence lands in a new series, and the reasons a write is refused.
 */
import { Temporal } from "temporal-polyfill";
import { type CreateEvent, type Event, EventSchema } from "./schema";
import { DATE_ONLY, startInstant } from "./until";

/**
 * Why Kompose won't make a series write. Each is refused before anything
 * changes; `originalStarts` are the original starts (as Google writes
 * them) of the occurrences the write would lose.
 */
export type SeriesRefusal =
  | { readonly reason: "severalRules" }
  | { readonly reason: "addedOccurrence" }
  | { readonly reason: "deleteFromAddedOccurrence" }
  | { readonly reason: "addedBeforeStart" }
  | { readonly reason: "endsBeforeStart" }
  | { readonly reason: "countUnknown" }
  | { readonly reason: "severalTimesADay" }
  | {
      readonly reason: "dropsChangedOccurrences";
      readonly originalStarts: readonly string[];
    };

/** "Mar 31": an original start's day, as the refusal names it. */
function dayName(originalStart: string): string {
  return Temporal.PlainDate.from(originalStart.slice(0, 10)).toLocaleString(
    "en-US",
    { day: "numeric", month: "short" }
  );
}

/** The refusal in words for the user. */
export function refusalMessage(refusal: SeriesRefusal): string {
  switch (refusal.reason) {
    case "severalRules":
      return "This and following isn't available for a series with more than one rule.";
    case "addedOccurrence":
      return "This and following isn't available for an occurrence added to the series on its own.";
    case "addedBeforeStart":
      return "This and following isn't available from this series' first meeting, since meetings were added before it. Use Entire series, or change them one at a time.";
    case "deleteFromAddedOccurrence":
      return "Deleting this and following isn't available from an occurrence added to this series.";
    case "endsBeforeStart":
      return "The repeat ends before this occurrence, so it can't start a new series here. Pick a later end.";
    case "countUnknown":
      return "This and following isn't available for this series: how many times it has left to repeat can't be worked out.";
    case "severalTimesADay":
      return "This series' meetings keep times of their own, so its time can't be changed for the entire series. Change one occurrence at a time.";
    case "dropsChangedOccurrences": {
      const days = refusal.originalStarts.map(dayName).join(", ");
      return `This would undo changes made to single occurrences (${days}), so it wasn't saved. Save it with This and following from a later occurrence, or undo those changes first.`;
    }
    default:
      return refusal satisfies never;
  }
}

/**
 * Fields that belong to the series and its occurrences alike. The rest
 * say which event this is (its ids, its place in the series, its
 * status), or are its times and rule, which each write sets itself.
 */
const NOT_SERIES_FIELDS = new Set<keyof Event>([
  "end",
  "eventType",
  "htmlLink",
  "iCalUID",
  "id",
  "locked",
  "organizer",
  "originalStartTime",
  "recurrence",
  "recurringEventId",
  "start",
  "status",
]);
// Object.keys loses the schema's key type: every key is an Event field,
// and those left are CreateEvent's too.
const SERIES_FIELDS = (
  Object.keys(EventSchema.shape) as (keyof Event)[]
).filter((field) => !NOT_SERIES_FIELDS.has(field)) as (keyof CreateEvent)[];

type Attendee = NonNullable<Event["attendees"]>[number];

/**
 * A field's value as compared across a series: empty ("" or []) is none,
 * as a form writes an empty field; attendees without their answers, which
 * each one gives per occurrence (a decline to one meeting is that
 * attendee's, not a change made to the occurrence).
 */
function comparable(field: keyof CreateEvent, value: unknown): unknown {
  if (value === "" || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  if (field !== "attendees" || !Array.isArray(value)) {
    return value ?? null;
  }
  return (value as Attendee[]).map(
    ({ comment: _comment, responseStatus: _response, ...attendee }) => attendee
  );
}

/** JSON with each object's keys sorted, so key order never differs. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : inner
  );
}

const same = (field: keyof CreateEvent, a: unknown, b: unknown) =>
  canonical(comparable(field, a)) === canonical(comparable(field, b));

/**
 * The fields the user changed in a save made from `from`, the occurrence
 * as the client loaded it: those `edited` has and that differ from it. A
 * field left out is unchanged (send "" or [] to clear one), so a client
 * may send the whole form or only what changed.
 */
export function changedFields(
  edited: Partial<CreateEvent>,
  from: Event
): Partial<CreateEvent> {
  return Object.fromEntries(
    SERIES_FIELDS.filter(
      (field) =>
        edited[field] !== undefined && !same(field, edited[field], from[field])
    ).map((field) => [field, edited[field]])
  );
}

/** Whether two Google times are the same moment (or the same date). */
export function sameTime(
  a: { date?: string; dateTime?: string; timeZone?: string },
  b: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): boolean {
  if (a.date || b.date) {
    return a.date === b.date;
  }
  const from = startInstant(a, zone);
  const to = startInstant(b, zone);
  return Boolean(from && to && Temporal.Instant.compare(from, to) === 0);
}

/** Whether `edited` keeps `occurrence`'s start and end. */
export function keepsTimes(
  edited: Pick<CreateEvent, "end" | "start">,
  occurrence: Pick<Event, "end" | "start">,
  zone: string
): boolean {
  return (
    sameTime(edited.start, occurrence.start, zone) &&
    sameTime(edited.end, occurrence.end, zone)
  );
}

/**
 * An occurrence's own changes, made to it alone: the fields it set apart
 * from its series (`master`), and its times when it was moved off its
 * `slot`. Empty for an occurrence that is just the series'.
 */
export function ownChanges(
  occurrence: Event,
  master: Event,
  slot: Pick<Event, "end" | "start">,
  zone: string
): Partial<CreateEvent> {
  const fields = Object.fromEntries(
    SERIES_FIELDS.filter(
      (field) => !same(field, occurrence[field], master[field])
    ).map((field) => [field, occurrence[field]])
  );
  return keepsTimes(occurrence, slot, zone)
    ? fields
    : { ...fields, end: occurrence.end, start: occurrence.start };
}

/**
 * Where an occurrence of the old series lands in a new one that starts at
 * `newStart` from `splitStart` (both the series' first meeting there):
 * as many days on as the new series moved, at its time of day (or on
 * that date, all day). Null when the form changes (timed to all day or
 * back): its times can't be carried over.
 */
export function placeInNewSeries(params: {
  newStart: Pick<Event["start"], "date" | "dateTime" | "timeZone">;
  originalStart: string;
  splitStart: string;
  zone: string;
}): string | null {
  const { newStart, originalStart, splitStart, zone } = params;
  const allDay = DATE_ONLY.test(splitStart);
  if (
    allDay !== Boolean(newStart.date) ||
    allDay !== DATE_ONLY.test(originalStart)
  ) {
    return null;
  }
  if (newStart.date) {
    const shift = Temporal.PlainDate.from(splitStart).until(newStart.date);
    return Temporal.PlainDate.from(originalStart).add(shift).toString();
  }
  const from = startInstant({ dateTime: splitStart }, zone);
  const to = startInstant(newStart, zone);
  const original = startInstant({ dateTime: originalStart }, zone);
  if (!(from && to && original)) {
    return null;
  }
  const days = from
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .until(to.toZonedDateTimeISO(zone).toPlainDate());
  return original
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .add(days)
    .toZonedDateTime({
      plainTime: to.toZonedDateTimeISO(zone).toPlainTime(),
      timeZone: zone,
    })
    .toString({ smallestUnit: "second", timeZoneName: "never" });
}
