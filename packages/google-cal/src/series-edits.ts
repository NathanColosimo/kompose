/**
 * What a series write changes and keeps, worked out before writing: the
 * fields an edit changed, an occurrence's own changes (Google keeps them as
 * exceptions tied to its original slot), and why a write is refused.
 */
import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { ruleDayCount } from "./series";

/** RFC 5545 weekday codes, Monday first (Temporal's `dayOfWeek` - 1). */
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

import { type CreateEvent, type Event, EventSchema } from "./schema";
import { lengthMs, startInstant } from "./until";

/**
 * Why a series write is refused, before anything changes, with no
 * occurrences to name. `severalTimesADay` is refused for good: only a
 * series made in another app has several rules (Kompose writes one), and
 * Kompose doesn't write that shape.
 */
const PLAIN_REFUSALS = [
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
const NAMING_REFUSALS = [
  "dropsChangedOccurrences",
  "resizesChangedOccurrences",
] as const;

/** Why a series write is refused (see `PLAIN_REFUSALS`, `NAMING_REFUSALS`). */
export const SeriesRefusalSchema = Schema.Union([
  Schema.Struct({ reason: Schema.Literals(PLAIN_REFUSALS) }),
  Schema.Struct({
    originalStarts: Schema.Array(Schema.String),
    reason: Schema.Literals(NAMING_REFUSALS),
    /** Only a series takes it: a new repeat. */
    seriesOnly: Schema.optional(Schema.Literal(true)),
    /**
     * The series has an exclusion rule (EXRULE, made in another app), which
     * isn't read here: the save may not cost the occurrences it names, but
     * that can't be told.
     */
    unsure: Schema.optional(Schema.Literal(true)),
  }),
]);

export type SeriesRefusal = typeof SeriesRefusalSchema.Type;

/** A refusal that names the occurrences it's for. */
export type NamingRefusal = Extract<SeriesRefusal, { originalStarts: unknown }>;

/**
 * "Mar 31": an original start's day, as the refusal names it, with its
 * year ("Mar 31, 2027") when the refusal spans more than one.
 */
function dayName(originalStart: string, withYear: boolean): string {
  return Temporal.PlainDate.from(originalStart.slice(0, 10)).toLocaleString(
    "en-US",
    withYear
      ? { day: "numeric", month: "short", year: "numeric" }
      : { day: "numeric", month: "short" }
  );
}

/** Whether a refusal's occurrences fall in more than one year. */
function spansYears(originalStarts: readonly string[]): boolean {
  return new Set(originalStarts.map((start) => start.slice(0, 4))).size > 1;
}

/**
 * "Nov 23, Nov 30": the occurrences a refusal names ("Dec 28, 2026; Jan 4,
 * 2027" across years).
 */
function namedDays(originalStarts: readonly string[]): string {
  const withYear = spansYears(originalStarts);
  return originalStarts
    .map((start) => dayName(start, withYear))
    .join(withYear ? "; " : ", ");
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
  // The series may have no meeting after it (its end), so none is promised.
  const following = `This and following${last ? ` from an occurrence after ${dayName(last, spansYears(refusal.originalStarts))}, if there is one` : ""}`;
  return refusal.seriesOnly
    ? `Save it with ${following}.`
    : `Save it for this occurrence only, or with ${following}.`;
}

/** The refusal in words for the user. */
export function refusalMessage(refusal: SeriesRefusal): string {
  switch (refusal.reason) {
    case "severalTimesADay":
      return "This series meets at several set times each day, so one new time can't replace them for the entire series. Change one occurrence at a time.";
    case "dropsChangedOccurrences":
      return refusal.unsure
        ? `This may undo what was changed or deleted on single occurrences (${namedDays(refusal.originalStarts)}): this series repeats in a way, made in another app, that can't be fully read here, so it wasn't saved. ${elsewhere(refusal)}`
        : `This would undo what was changed or deleted on single occurrences (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    case "resizesChangedOccurrences":
      return `This would also change the length of single occurrences given a length of their own (${namedDays(refusal.originalStarts)}), so it wasn't saved. ${elsewhere(refusal)}`;
    default:
      return refusal satisfies never;
  }
}

/**
 * Fields a series and its occurrences don't share: which event this is
 * (ids, place in the series), and its times and rule, which each write
 * sets itself. Status is shared: an occurrence marked tentative on its own
 * has a change of its own (a cancelled one is a deleted occurrence).
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
]);
// Object.keys loses the schema's key type: every key is an Event field,
// and those left are CreateEvent's too.
const SERIES_FIELDS = (
  Object.keys(EventSchema.shape) as (keyof Event)[]
).filter((field) => !NOT_SERIES_FIELDS.has(field)) as (keyof CreateEvent)[];

type Attendee = NonNullable<Event["attendees"]>[number];

/** The value Google gives a field an event leaves out. */
const GOOGLE_DEFAULTS: Partial<Record<keyof CreateEvent, unknown>> = {
  anyoneCanAddSelf: false,
  guestsCanInviteOthers: true,
  guestsCanModify: false,
  guestsCanSeeOtherGuests: true,
  status: "confirmed",
  transparency: "opaque",
  visibility: "default",
};

/**
 * A field's value as compared across a series. "" and [] are none, as a
 * form writes them. Attendees drop their answers: those are per meeting,
 * not a change to the occurrence.
 */
function comparable(field: keyof CreateEvent, value: unknown): unknown {
  // A field left out is Google's default (an event without a status is
  // confirmed), so the two are no change.
  if (field in GOOGLE_DEFAULTS) {
    return value ?? GOOGLE_DEFAULTS[field];
  }
  if (value === "" || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  if (field !== "attendees" || !Array.isArray(value)) {
    return value ?? null;
  }
  // In any order: the same guests listed differently are no change.
  return (value as Attendee[])
    .map(
      ({ comment: _comment, responseStatus: _response, ...attendee }) =>
        attendee
    )
    .sort((a, b) => ((a.email ?? "") < (b.email ?? "") ? -1 : 1));
}

/**
 * The guests a series write sends: the series' own, less those the edit
 * removed (on the occurrence it was made through, not sent) and with
 * those it added (sent, on neither). A guest an occurrence added or
 * dropped on its own is its own, not the series'. Each guest keeps the
 * answer and comment the series has for them.
 */
export function seriesAttendees(params: {
  edited: Attendee[];
  occurrence: Attendee[] | undefined;
  series: Attendee[] | undefined;
}): Attendee[] {
  const emails = (guests: Attendee[] | undefined) =>
    new Set((guests ?? []).flatMap((guest) => guest.email ?? []));
  const onOccurrence = emails(params.occurrence);
  const onSeries = emails(params.series);
  const sent = new Map(
    params.edited.flatMap((guest) =>
      guest.email ? [[guest.email, guest]] : []
    )
  );
  const kept = (params.series ?? []).flatMap((guest) => {
    const edit = guest.email === undefined ? undefined : sent.get(guest.email);
    if (!edit) {
      const removed =
        guest.email !== undefined && onOccurrence.has(guest.email);
      return removed ? [] : [guest];
    }
    const { comment: _comment, responseStatus: _response, ...rest } = edit;
    return [
      {
        ...rest,
        ...(guest.comment === undefined ? {} : { comment: guest.comment }),
        ...(guest.responseStatus === undefined
          ? {}
          : { responseStatus: guest.responseStatus }),
      },
    ];
  });
  const added = params.edited.filter(
    (guest) =>
      guest.email === undefined ||
      !(onSeries.has(guest.email) || onOccurrence.has(guest.email))
  );
  return [...kept, ...added];
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
 * The fields a save changed from `from` (the occurrence as the server
 * reads it from Google just before the write). A field left out is
 * unchanged, so a client may send the whole form or only what changed; one
 * sent empty ("", [] or undefined, as the editors clear a color) is
 * cleared.
 */
export function changedFields(
  edited: Partial<CreateEvent>,
  from: Event
): Partial<CreateEvent> {
  return Object.fromEntries(
    SERIES_FIELDS.filter(
      (field) =>
        Object.hasOwn(edited, field) && !same(field, edited[field], from[field])
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

const WEEKLY = /FREQ=WEEKLY/;
const BYDAY_VALUE = /BYDAY=([^;]+)/;

/** A rule line's parts, sorted, without its day parts when `dropDays`. */
function ruleParts(line: string, dropDays: boolean): string {
  const [name, parts = ""] = line.split(":");
  return canonicalRule(
    `${name}:${parts
      .split(";")
      .filter((part) => !(dropDays && DAY_PARTS.has(part.split("=")[0] ?? "")))
      .join(";")}`
  );
}

/**
 * A rule line written one way: its parts, and the values in each list
 * (BYDAY=WE,MO is BYDAY=MO,WE), in order. Order means nothing in either.
 */
export function canonicalRule(line: string): string {
  const [name, parts = ""] = line.split(":");
  const sorted = parts
    .split(";")
    .filter(Boolean)
    .map((part) => {
      const [key, values = ""] = part.split("=");
      return key?.startsWith("BY")
        ? `${key}=${values.split(",").sort().join(",")}`
        : part;
    })
    .sort();
  return `${name}:${sorted.join(";")}`;
}

/**
 * Whether `saved` is `own` rebuilt for a series moved from the day `from`
 * to `to`: a weekly rule meets on its other weekdays still, the moved one
 * swapped for the new day's (or kept); any other picks as many days in
 * the two years from its start. One the rule library can't read is taken
 * as rebuilt.
 */
function rebuiltForDay(
  own: string,
  saved: string,
  moved: { from: Temporal.PlainDate; to: Temporal.PlainDate }
): boolean {
  const { from, to } = moved;
  if (WEEKLY.test(own)) {
    const weekdays = (rule: string, start: Temporal.PlainDate) => {
      const listed = BYDAY_VALUE.exec(rule)?.[1]?.split(",");
      return new Set(listed ?? [WEEKDAY_CODES[start.dayOfWeek - 1] ?? ""]);
    };
    const before = weekdays(own, from);
    const after = [...weekdays(saved, to)].sort().join(",");
    before.delete(WEEKDAY_CODES[from.dayOfWeek - 1] ?? "");
    before.add(WEEKDAY_CODES[to.dayOfWeek - 1] ?? "");
    return (
      after === [...before].sort().join(",") ||
      after === [...weekdays(own, from)].sort().join(",")
    );
  }
  const daysIn = (rule: string, start: Temporal.PlainDate) =>
    ruleDayCount({
      from: start,
      rule,
      through: start.add({ years: 2 }).subtract({ days: 1 }),
    });
  const before = daysIn(own, from);
  const after = daysIn(saved, to);
  // Two years from another day can hold one day more or less.
  return before === null || after === null || Math.abs(before - after) <= 1;
}

/**
 * Whether a save gives the series a new repeat: its rules (`saved`; none
 * sent means the series' own) differ from `own`. Moved to another day
 * (`moved`), a client rebuilds a rule's day parts (`DAY_PARTS`) for it,
 * so those may differ when they still pick the days the old rule did
 * (`rebuiltForDay`); several rules' day parts aren't compared.
 */
export function newRepeat(params: {
  moved: { from: Temporal.PlainDate; to: Temporal.PlainDate } | null;
  own: readonly string[];
  saved: readonly string[] | undefined;
}): boolean {
  const { moved, own, saved } = params;
  if (!saved) {
    return false;
  }
  const rulesOf = (recurrence: readonly string[]) =>
    recurrence.filter(
      (line) => line.startsWith("RRULE:") || line.startsWith("EXRULE:")
    );
  const written = (recurrence: readonly string[], dropDays: boolean) =>
    canonical(
      rulesOf(recurrence)
        .map((line) => ruleParts(line, dropDays))
        .sort()
    );
  if (written(saved, false) === written(own, false)) {
    return false;
  }
  if (!moved || written(saved, true) !== written(own, true)) {
    return true;
  }
  const [ownRule, ...ownOthers] = rulesOf(own);
  const [savedRule, ...savedOthers] = rulesOf(saved);
  if (!(ownRule && savedRule) || ownOthers.length + savedOthers.length > 0) {
    return false;
  }
  return !rebuiltForDay(ownRule, savedRule, moved);
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
