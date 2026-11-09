/**
 * What a series write changes and keeps, worked out before writing: the
 * fields an edit changed, an occurrence's own changes (Google keeps them as
 * exceptions tied to its original slot), and why a write is refused.
 */
import { Temporal } from "temporal-polyfill";
import { type CreateEvent, type Event, EventSchema } from "./schema";
import { lengthMs, startInstant } from "./until";

/**
 * Why a series write is refused, before anything changes, with no
 * occurrences to name. `severalTimesADay` has a safe write, which a later
 * change adds.
 */
export const PLAIN_REFUSALS = [
  // A new time for an entire series that meets several times a day: its
  // start's time is one of several, each a rule of its own.
  "severalTimesADay",
] as const;

/**
 * Refusals that name, by original start, the occurrences changed on their
 * own that Google would drop (a new start, or a rule without their slot)
 * or whose own length it would overwrite (a new length). Writing them back
 * afterwards can fail with nothing to restore them from.
 */
export const NAMING_REFUSALS = [
  "dropsChangedOccurrences",
  "resizesChangedOccurrences",
] as const;

/** Why a series write is refused (see `PLAIN_REFUSALS`, `NAMING_REFUSALS`). */
export type SeriesRefusal =
  | { readonly reason: (typeof PLAIN_REFUSALS)[number] }
  | {
      readonly reason: (typeof NAMING_REFUSALS)[number];
      readonly originalStarts: readonly string[];
      /** Only a series takes it: a new repeat. */
      readonly seriesOnly?: true;
    };

/** A refusal that names the occurrences it's for. */
type NamingRefusal = Extract<SeriesRefusal, { originalStarts: unknown }>;

/** "Mar 31": an original start's day, as the refusal names it. */
function dayName(originalStart: string): string {
  return Temporal.PlainDate.from(originalStart.slice(0, 10)).toLocaleString(
    "en-US",
    { day: "numeric", month: "short" }
  );
}

/** "Nov 23, Nov 30": the occurrences a refusal names. */
function namedDays(originalStarts: readonly string[]): string {
  return originalStarts.map(dayName).join(", ");
}

/**
 * Where the save can go instead: This and following after the last named
 * occurrence, or this occurrence alone when it can take the save.
 */
function elsewhere(refusal: NamingRefusal): string {
  const last = refusal.originalStarts
    .map((start) => start.slice(0, 10))
    .sort()
    .at(-1);
  const following = `This and following${last ? ` from an occurrence after ${dayName(last)}` : ""}`;
  return refusal.seriesOnly
    ? `Save it with ${following}.`
    : `Save it for this occurrence only, or with ${following}.`;
}

/** The refusal in words for the user. */
export function refusalMessage(refusal: SeriesRefusal): string {
  switch (refusal.reason) {
    case "severalTimesADay":
      return "This series' meetings keep times of their own, so its time can't be changed for the entire series. Change one occurrence at a time.";
    case "dropsChangedOccurrences":
      return `This would undo changes made to single occurrences (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    case "resizesChangedOccurrences":
      return `This would also change the length of single occurrences given a length of their own (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    default:
      return refusal satisfies never;
  }
}

/**
 * Fields a series and its occurrences don't share: which event this is
 * (ids, place in the series, status), and its times and rule, which each
 * write sets itself.
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
 * A field's value as compared across a series. "" and [] are none, as a
 * form writes them. Attendees drop their answers: those are per meeting,
 * not a change to the occurrence.
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
 * The fields a save changed from `from` (the occurrence as the client
 * loaded it). A field left out is unchanged (send "" or [] to clear one),
 * so a client may send the whole form or only what changed.
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

/** The rule parts that pick which days it meets on. */
const DAY_PARTS = new Set([
  "BYDAY",
  "BYMONTH",
  "BYMONTHDAY",
  "BYSETPOS",
  "BYWEEKNO",
  "BYYEARDAY",
]);

/**
 * Whether a save gives the series a new repeat: its rules (`saved`; none
 * sent means the series' own) differ from `own`. A client that moves the
 * series' day rebuilds its rules' day parts for it, so `DAY_PARTS` aren't
 * compared.
 */
export function newRepeat(params: {
  dayMoved: boolean;
  own: readonly string[];
  saved: readonly string[] | undefined;
}): boolean {
  const { dayMoved, own, saved } = params;
  if (!saved) {
    return false;
  }
  const rules = (recurrence: readonly string[]) =>
    recurrence
      .filter((line) => line.startsWith("RRULE:") || line.startsWith("EXRULE:"))
      .map((line) => {
        const [name, parts = ""] = line.split(":");
        const kept = parts
          .split(";")
          .filter(
            (part) => !(dayMoved && DAY_PARTS.has(part.split("=")[0] ?? ""))
          )
          .sort();
        return `${name}:${kept.join(";")}`;
      })
      .sort();
  return canonical(rules(saved)) !== canonical(rules(own));
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

/** Whether two events last as long: as many days, or as much time. */
export function sameLength(
  a: Pick<Event, "end" | "start">,
  b: Pick<Event, "end" | "start">,
  zone: string
): boolean {
  if (a.start.date || b.start.date) {
    const days = (time: Pick<Event, "end" | "start">) =>
      time.start.date && time.end.date
        ? Temporal.PlainDate.from(time.start.date).until(time.end.date).days
        : null;
    return days(a) !== null && days(a) === days(b);
  }
  const length = lengthMs(a.start, a.end, zone);
  return length !== null && length === lengthMs(b.start, b.end, zone);
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
 * An occurrence's own changes: the fields it sets apart from `master`, and
 * its times when moved off its `slot`. Empty when it has none.
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
