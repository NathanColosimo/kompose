import { Context, Effect, Layer, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  sanitizeEventPayload,
  seriesMeetsAt,
  skipping,
  truncateRecurrenceForFollowing,
} from "./recurrence-utils";
import { isRuleDay } from "./rule-days";
import {
  type Calendar,
  CalendarSchema,
  type Colors,
  ColorsSchema,
  type CreateCalendar,
  type CreateEvent,
  type Event,
  EventSchema,
  type RecurrenceScope,
} from "./schema";
import {
  changedFields,
  keepsTimes,
  NAMING_REFUSALS,
  newRepeat,
  ownChanges,
  PLAIN_REFUSALS,
  refusalMessage,
  type SeriesRefusal,
  sameLength,
  sameTime,
} from "./series-edits";
import {
  seriesSlotAt,
  seriesTimesForEdit,
  seriesZoneOf,
  slotOf,
} from "./series-times";
import {
  clockOf,
  DATE_ONLY,
  dayOfStart,
  googleDateTime,
  lengthMs,
  meetsSeveralTimesADay,
  momentOf,
  startInstant,
} from "./until";

/** A rule part that ends it: COUNT or UNTIL. */
const END_PART = /^(?:COUNT|UNTIL)=/;

interface GoogleWatchChannelInput {
  address: string;
  expiration: string;
  id: string;
  token: string;
}

interface GoogleWatchChannelResult {
  channelId: string;
  expiration?: string;
  resourceId: string;
}

/**
 * The start's time of day before and after an edit to `start`, when both
 * are timed and it changes; null otherwise.
 */
function timeOfDayChange(
  master: Event,
  start: Event["start"]
): { from: Temporal.PlainTime; to: Temporal.PlainTime } | null {
  const zone = seriesZoneOf(master);
  const from = clockOf(master.start, zone);
  const to = clockOf(start, zone);
  return from && to && Temporal.PlainTime.compare(from, to) !== 0
    ? { from, to }
    : null;
}

/**
 * A refusal naming the occurrences (by original start) a save would cost,
 * marked when the save is one only a series takes.
 */
function naming(
  reason: "dropsChangedOccurrences" | "resizesChangedOccurrences",
  originalStarts: readonly string[],
  seriesOnly: boolean
): SeriesRefusal {
  return seriesOnly
    ? { originalStarts, reason, seriesOnly: true }
    : { originalStarts, reason };
}

/**
 * Whether the save's rules (`saved`) give `master` a new repeat, which one
 * occurrence can't take. Moving the first meeting (`from`) to another day
 * moves the series' days with it.
 */
function givesNewRepeat(params: {
  from: Event["start"];
  master: Event;
  saved: string[] | undefined;
  start: Event["start"];
}): boolean {
  const zone = seriesZoneOf(params.master);
  const day = dayOfStart(params.start, zone);
  return newRepeat({
    dayMoved: !(day && dayOfStart(params.from, zone)?.equals(day)),
    own: params.master.recurrence ?? [],
    saved: params.saved,
  });
}

/** A slot as a start: a date, or a date-time. */
function asStart(slot: string): Event["start"] {
  return DATE_ONLY.test(slot) ? { date: slot } : { dateTime: slot };
}

/** A refusal, as the service fails with it. */
function refused(refusal: SeriesRefusal): GoogleApiError {
  return new GoogleApiError({
    cause: new Error(refusalMessage(refusal)),
    refusal,
  });
}

/**
 * Whether `occurrence` is its series' first meeting: the master, or the
 * occurrence at its start (not an added meeting before it).
 */
function opensSeries(occurrence: Event, master: Event): boolean {
  if (!occurrence.recurringEventId) {
    return true;
  }
  const zone = seriesZoneOf(master);
  const original = momentOf(
    occurrence.originalStartTime ?? occurrence.start,
    zone
  );
  const first = momentOf(master.start, zone);
  return Boolean(
    original && first && Temporal.Instant.compare(original, first) === 0
  );
}

/**
 * The zone a series repeats in once `start` is written: its own, or, for
 * an all-day series made timed, the new start's.
 */
function repeatZone(
  master: { start: { timeZone?: string } },
  start: { timeZone?: string }
): string {
  return master.start.timeZone ?? start.timeZone ?? "UTC";
}

/**
 * `time` as the same moment in the series' zone, if it has one. A
 * date-time without an offset is read in its own zone, as Google does.
 */
function inSeriesZone<
  T extends { date?: string; dateTime?: string; timeZone?: string },
>(time: T, series: { timeZone?: string }): T {
  if (!(time.dateTime && series.timeZone)) {
    return time;
  }
  const moment = startInstant(time, series.timeZone);
  const dateTime = moment
    ? googleDateTime(moment.toZonedDateTimeISO(series.timeZone))
    : time.dateTime;
  return { ...time, dateTime, timeZone: series.timeZone };
}

/** An occurrence's original start: the slot it holds in its series. */
function originalStartOf(occurrence: Event, zone: string): string | null {
  return slotOf(occurrence.originalStartTime ?? occurrence.start, zone);
}

/**
 * `master`'s times from its own start with `edited`'s length (or span of
 * days, all day); null when the forms differ or a time doesn't parse.
 */
function withLength(
  master: Event,
  edited: Pick<CreateEvent, "end" | "start">
): { end: Event["end"]; start: Event["start"] } | null {
  const zone = seriesZoneOf(master);
  if (master.start.date && edited.start.date && edited.end.date) {
    const days = Temporal.PlainDate.from(edited.start.date).until(
      edited.end.date
    ).days;
    return {
      end: {
        date: Temporal.PlainDate.from(master.start.date)
          .add({ days: Math.max(1, days) })
          .toString(),
      },
      start: master.start,
    };
  }
  const from = startInstant(master.start, zone);
  const length = lengthMs(edited.start, edited.end, zone);
  if (!(from && length !== null) || edited.start.date) {
    return null;
  }
  return {
    end: {
      dateTime: googleDateTime(
        from.add({ milliseconds: length }).toZonedDateTimeISO(zone)
      ),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: master.start,
  };
}

/**
 * A series' times after an "Entire series" edit through `occurrence`.
 * Times the edit left keep the series' (an occurrence moved on its own
 * doesn't move it), and a new end alone changes only the length. Only an
 * edit to the first meeting moves the series' date, and only to a day its
 * rules are known to meet on: Google always meets at a series' start, so
 * any other day would add a meeting the rules don't make. Elsewhere a date
 * move is "This and following" only. Google repeats a series in its
 * start's zone, so times are read in it.
 */
function entireSeriesTimes(
  edited: CreateEvent,
  occurrence: Event,
  master: Event
): { end: Event["end"]; start: Event["start"] } {
  const zone = seriesZoneOf(master);
  const kept = { end: master.end, start: master.start };
  if (keepsTimes(edited, occurrence, zone)) {
    return kept;
  }
  if (sameTime(edited.start, occurrence.start, zone)) {
    return withLength(master, edited) ?? kept;
  }
  const end = inSeriesZone(edited.end, master.end);
  const start = inSeriesZone(edited.start, master.start);
  const rules = (edited.recurrence ?? master.recurrence ?? []).filter((line) =>
    line.startsWith("RRULE:")
  );
  const day = dayOfStart(start, zone);
  const rulesMeet =
    !day ||
    rules.length === 0 ||
    rules.some((rule) => isRuleDay(rule, day, day) === true);
  // A day the opened meeting already had on its own isn't a new one.
  const movesDay = !day?.equals(dayOfStart(occurrence.start, zone) ?? day);
  if (opensSeries(occurrence, master) && rulesMeet && movesDay) {
    return { end: oneForm(end), start: oneForm(start) };
  }
  return (
    seriesTimesForEdit({
      editedEnd: end,
      editedStart: start,
      masterEnd: master.end,
      masterStart: master.start,
    }) ?? kept
  );
}

/**
 * An Entire series edit's times on the opened occurrence's own day (the
 * series keeps its dates). Its own times if they don't parse.
 */
function timesOnOwnDay(
  occurrence: Event,
  edited: CreateEvent,
  master: Event
): { end: Event["end"]; start: Event["start"] } {
  return (
    seriesTimesForEdit({
      editedEnd: inSeriesZone(edited.end, master.end),
      editedStart: inSeriesZone(edited.start, master.start),
      masterEnd: occurrence.end,
      masterStart: inSeriesZone(occurrence.start, master.start),
    }) ?? { end: occurrence.end, start: occurrence.start }
  );
}

/**
 * Whether the series' new times give `occurrence`, changed on its own,
 * all it changed: only its times, to those of the new series' meeting on
 * its day. Google cancels it when the series' start moves, and that
 * meeting takes its place.
 */
function newTimesKeep(params: {
  /** The fields the edit changed, which the new series' meeting takes. */
  changes: Partial<CreateEvent>;
  master: Event;
  occurrence: Event;
  originalStart: string;
  recurrence: string[];
  times: { end: Event["end"]; start: Event["start"] };
}): boolean {
  const { master, occurrence, originalStart, recurrence, times } = params;
  const zone = seriesZoneOf(master);
  const day = dayOfStart(asStart(originalStart), zone);
  const clock = clockOf(times.start, zone);
  if (!(day && clock && master.start.dateTime)) {
    return false;
  }
  const slot = googleDateTime(
    day.toZonedDateTime({ plainTime: clock, timeZone: zone })
  );
  return (
    seriesMeetsAt({
      recurrence,
      seriesZone: zone,
      slot,
      start: times.start,
    }) === true &&
    Object.keys(
      ownChanges(occurrence, master, seriesSlotAt(times, slot), zone)
    ).every(
      // A value the edit gives the whole series is the new meeting's too.
      (field) => {
        const value = params.changes[field as keyof CreateEvent];
        return (
          value !== undefined &&
          Object.keys(changedFields({ [field]: value }, occurrence)).length ===
            0
        );
      }
    )
  );
}

/**
 * A time in one form: a date when it has one (a form that toggled to all
 * day can keep its old date-time), else its date-time.
 */
function oneForm(time: Event["start"]): Event["start"] {
  return time.date
    ? { date: time.date }
    : { dateTime: time.dateTime, timeZone: time.timeZone };
}

/** Whether the series' own rules (not an added day) meet at `slot`. */
function ruleMeetingAt(slot: string, master: Event): boolean {
  return (
    seriesMeetsAt({
      recurrence: (master.recurrence ?? []).filter((line) =>
        line.startsWith("RRULE:")
      ),
      seriesZone: seriesZoneOf(master),
      slot,
      start: master.start,
    }) === true
  );
}

/**
 * A rule meeting's place once the series starts at `start` (it meets once
 * a day): its own day at the new time, or its date made all day. Null if
 * it doesn't parse.
 */
function placeOnNewStart(
  slot: string,
  master: Event,
  start: Event["start"]
): string | null {
  const day = dayOfStart(asStart(slot), seriesZoneOf(master));
  const repeatsIn = repeatZone(master, start);
  const clock = clockOf(start, repeatsIn);
  if (!day) {
    return null;
  }
  return clock
    ? googleDateTime(
        day.toZonedDateTime({ plainTime: clock, timeZone: repeatsIn })
      )
    : day.toString();
}

/**
 * Whether the saved series has `place`, or ends before it: a meeting past
 * its new end goes with the rest, not lost.
 */
function keptOrEnded(params: {
  master: Event;
  place: string;
  recurrence: string[];
  start: Event["start"];
}): boolean {
  const { master, place, start } = params;
  const seriesZone = repeatZone(master, start);
  // Read without skips: the save's own skip for it is already there.
  const rules = params.recurrence.filter((line) => line.startsWith("RRULE:"));
  const unbounded = rules.map(
    (line) =>
      `RRULE:${line
        .slice("RRULE:".length)
        .split(";")
        .filter((part) => !END_PART.test(part))
        .join(";")}`
  );
  const meets = (recurrence: string[]) =>
    seriesMeetsAt({ recurrence, seriesZone, slot: place, start }) === true;
  return meets(rules) || meets(unbounded);
}

/**
 * Where the occurrences deleted on their own (`cancelled`, original
 * starts) are skipped once a series that meets once a day starts at
 * `start`: a rule's meeting at its place there (`placeOnNewStart`); an
 * added (RDATE) one where it was, unless the series changes form.
 */
function deletedSlots(params: {
  cancelled: string[];
  master: Event;
  start: Event["start"];
}): string[] {
  const { cancelled, master, start } = params;
  const keepsForm = Boolean(master.start.date) === Boolean(start.date);
  if (keepsForm && !timeOfDayChange(master, start)) {
    return cancelled;
  }
  return cancelled.map((slot) =>
    ruleMeetingAt(slot, master) || !keepsForm
      ? (placeOnNewStart(slot, master, start) ?? slot)
      : slot
  );
}

/**
 * The rule meetings deleted on their own whose place after a new start
 * (where `deletedSlots` skips them) isn't one of the saved series': after
 * a first meeting's day move under a rule whose days follow its start
 * (monthly on the start's date, say), the meeting now in its place would
 * come back.
 */
function deletedLost(params: {
  cancelled: string[];
  master: Event;
  recurrence: string[];
  times: { end: Event["end"]; start: Event["start"] };
}): string[] {
  const { master, recurrence, times } = params;
  const first = momentOf(times.start, repeatZone(master, times.start));
  return params.cancelled.filter((slot) => {
    const place = ruleMeetingAt(slot, master)
      ? placeOnNewStart(slot, master, times.start)
      : null;
    const at =
      place && momentOf(asStart(place), repeatZone(master, times.start));
    // Before the new start, the series has no meeting to bring back.
    if (!(place && at && first) || Temporal.Instant.compare(at, first) < 0) {
      return false;
    }
    return !keptOrEnded({ master, place, recurrence, start: times.start });
  });
}

/**
 * Why an Entire series write would cost the occurrences changed on their
 * own (`changed`) their changes; null if it wouldn't. Google ties each to
 * its original slot: it cancels all of them when the series' start moves
 * (one the new series meets at its own times loses nothing), and each
 * whose slot the new rule drops. A length-only change keeps them but gives
 * each the new length (the opened one takes the edit's, and one that
 * already has it loses nothing, so neither is counted).
 */
function seriesChangeRefusal(params: {
  /** The occurrences deleted on their own, by original start. */
  cancelled: string[];
  changed: { occurrence: Event; originalStart: string }[];
  /** The fields the edit changed. */
  changes: Partial<CreateEvent>;
  master: Event;
  /** Whether the start or the rule changes (else only the length). */
  movesSlots: boolean;
  opened: Event;
  recurrence: string[];
  /** The rules the save sends; left out, the series' own. */
  saved: string[] | undefined;
  times: { end: Event["end"]; start: Event["start"] };
}): SeriesRefusal | null {
  const { changed, master, movesSlots, opened, recurrence, times } = params;
  const zone = seriesZoneOf(master);
  const seriesOnly = givesNewRepeat({
    from: master.start,
    master,
    saved: params.saved,
    start: times.start,
  });
  const movesStart = !sameTime(times.start, master.start, zone);
  const lost = changed
    .filter(({ occurrence, originalStart }) => {
      if (movesStart && occurrence.id === opened.id) {
        // The edit replaces its time and the fields it changes, but not a
        // day of its own, which Google would give back to the series,
        // unless it's the first meeting and the series moves to its day.
        const ownDay = dayOfStart(occurrence.start, zone);
        const first = opensSeries(occurrence, master);
        const movedDay = !(
          (first && ownDay?.equals(dayOfStart(times.start, zone) ?? ownDay)) ||
          ownDay?.equals(dayOfStart(asStart(originalStart), zone) ?? ownDay)
        );
        // The saved series must still meet in its place (the first meeting's
        // is the new start).
        const place = placeOnNewStart(originalStart, master, times.start);
        const replaced =
          first ||
          (place !== null &&
            keptOrEnded({ master, place, recurrence, start: times.start }));
        return (
          movedDay ||
          !replaced ||
          Object.keys(changesOwnTo(occurrence, master, zone)).some(
            (field) =>
              field !== "start" && field !== "end" && !(field in params.changes)
          )
        );
      }
      if (movesStart) {
        return !newTimesKeep({
          changes: params.changes,
          master,
          occurrence,
          originalStart,
          recurrence,
          times,
        });
      }
      return (
        movesSlots &&
        seriesMeetsAt({
          recurrence,
          seriesZone: repeatZone(master, times.start),
          slot: originalStart,
          start: times.start,
        }) !== true
      );
    })
    .map(({ originalStart }) => originalStart);
  if (movesStart) {
    lost.push(...deletedLost(params));
  }
  if (lost.length > 0) {
    return naming("dropsChangedOccurrences", lost, seriesOnly);
  }
  if (sameLength(times, master, zone)) {
    return null;
  }
  const resized = changed
    .filter(
      ({ occurrence }) =>
        occurrence.id !== opened.id &&
        !sameLength(occurrence, master, zone) &&
        !sameLength(occurrence, times, zone)
    )
    .map(({ originalStart }) => originalStart);
  return resized.length > 0
    ? naming("resizesChangedOccurrences", resized, seriesOnly)
    : null;
}

/**
 * Whether an Entire series edit through `occurrence` gives a series that
 * meets several times a day a new time of day: the series' start's, or
 * the opened meeting's own (a 15:00 meeting moved, its start's 9:00 kept).
 * Such a time can't move without moving one time onto another, or off its
 * own.
 */
function movesSeveralADay(
  master: Event,
  start: Event["start"],
  edited: CreateEvent,
  occurrence: Event
): boolean {
  const zone = seriesZoneOf(master);
  const from = clockOf(master.start, zone);
  const was = clockOf(occurrence.start, zone);
  const now = clockOf(edited.start, zone);
  const moves =
    timeOfDayChange(master, start) !== null ||
    Boolean(was && now && !was.equals(now));
  return Boolean(
    from && moves && meetsSeveralTimesADay(master.recurrence ?? [], from)
  );
}

/** A slot's moment (a date's start, in `zone`); null if it doesn't parse. */
function slotMoment(slot: string, zone: string): Temporal.Instant | null {
  return momentOf(asStart(slot), zone);
}

/**
 * `master`'s exceptions in Google's listing: the cancelled ones' original
 * starts, and the moved or edited ones.
 */
function sortExceptions(events: SeriesListing[], master: Event) {
  const zone = seriesZoneOf(master);
  const cancelled: string[] = [];
  const changed: { occurrence: Event; originalStart: string }[] = [];
  for (const event of events) {
    const originalStart =
      event.recurringEventId === master.id && event.originalStartTime
        ? slotOf(event.originalStartTime, zone)
        : null;
    const moment = originalStart && slotMoment(originalStart, zone);
    if (!(originalStart && moment)) {
      continue;
    }
    if (event.status === "cancelled" || !("start" in event)) {
      cancelled.push(originalStart);
    } else if (Object.keys(changesOwnTo(event, master, zone)).length > 0) {
      // One moved and moved back has nothing to keep.
      changed.push({ occurrence: event, originalStart });
    }
  }
  return { cancelled, changed };
}

/**
 * A cancelled occurrence as Google lists it: only its ids and original
 * start are certain.
 */
const CancelledOccurrenceSchema = z.object({
  id: z.string(),
  originalStartTime: EventSchema.shape.originalStartTime,
  recurringEventId: z.string().optional(),
  status: z.literal("cancelled"),
});

/** A series' master and its exceptions, as listed by iCalUID. */
const SeriesListingSchema = z.array(
  z.union([CancelledOccurrenceSchema, EventSchema])
);
type SeriesListing = z.infer<typeof SeriesListingSchema>[number];

/** `occurrence`'s own changes (see `ownChanges`), from its original start. */
function changesOwnTo(
  occurrence: Event,
  master: Event,
  zone: string
): Partial<CreateEvent> {
  const originalStart = originalStartOf(occurrence, zone);
  if (!originalStart) {
    return {};
  }
  return ownChanges(
    occurrence,
    master,
    seriesSlotAt(master, originalStart),
    zone
  );
}

function getConferenceDataVersion(event: {
  conferenceData?: unknown;
}): number | undefined {
  return event.conferenceData ? 1 : undefined;
}

function summarizeEventForDebug(event: CreateEvent) {
  return {
    summary: event.summary,
    eventType: event.eventType ?? "default",
    hasFocusTimeProperties: Boolean(event.focusTimeProperties),
    hasOutOfOfficeProperties: Boolean(event.outOfOfficeProperties),
    hasWorkingLocationProperties: Boolean(event.workingLocationProperties),
    recurrenceCount: event.recurrence?.length ?? 0,
    start: event.start,
    end: event.end,
  };
}

function logGoogleEventUpdateFailure(params: {
  operation: "create" | "update";
  calendarId: string;
  eventId?: string;
  scope?: string;
  event: CreateEvent;
  cause: unknown;
}) {
  console.error("[GoogleCalendar] Event mutation failed", {
    operation: params.operation,
    calendarId: params.calendarId,
    eventId: params.eventId,
    scope: params.scope,
    event: summarizeEventForDebug(params.event),
    cause: params.cause,
  });
}

function buildThisOccurrenceUpdatePayload(
  event: CreateEvent,
  currentEvent: Event
): CreateEvent {
  if (!currentEvent.recurringEventId) {
    return event;
  }

  const { recurrence: _recurrence, ...singleOccurrence } = event;
  return {
    ...singleOccurrence,
    recurringEventId: currentEvent.recurringEventId,
    ...(currentEvent.originalStartTime
      ? { originalStartTime: currentEvent.originalStartTime }
      : {}),
  };
}

// -- Service Definition --

export interface GoogleCalendarService {
  readonly createCalendar: (
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly createEvent: (
    calendarId: string,
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly deleteCalendar: (
    calendarId: string
  ) => Effect.Effect<void, GoogleApiError>;
  /**
   * Delete an event, supporting recurring scopes.
   *
   * - `this`: cancels just the instance/eventId by setting status to "cancelled"
   * - `all`: deletes the series master
   * - `following`: truncates the original series at the occurrence date
   *
   * Non-recurring events accept `all`; only `following` requires a series.
   */
  readonly deleteEvent: (
    calendarId: string,
    eventId: string,
    scope: RecurrenceScope
  ) => Effect.Effect<void, GoogleApiError | GoogleCalendarZodError>;
  readonly getCalendar: (
    calendarId: string
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly getEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly getMasterRecurrence: (
    calendarId: string,
    event: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly listCalendarIds: () => Effect.Effect<
    string[],
    GoogleApiError | GoogleCalendarZodError
  >;
  // Calendar Operations
  readonly listCalendars: () => Effect.Effect<
    Calendar[],
    GoogleApiError | GoogleCalendarZodError
  >;

  readonly listColors: () => Effect.Effect<
    Colors,
    GoogleApiError | GoogleCalendarZodError
  >;

  // Event Operations
  readonly listEvents: (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) => Effect.Effect<Event[], GoogleApiError | GoogleCalendarZodError>;
  /**
   * Move an event between calendars, supporting recurring scopes.
   *
   * - `this`: moves just the instance/eventId
   * - `all`: moves the series master
   * - `following`: truncates the original series and creates a new series in the destination
   *
   * If `scope !== \"this\"` and the event is not recurring, this returns an error.
   */
  readonly moveEvent: (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string,
    scope: RecurrenceScope
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly stopWatch: (params: {
    channelId: string;
    resourceId: string;
  }) => Effect.Effect<void, GoogleApiError>;
  readonly updateCalendar: (
    calendarId: string,
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly updateEvent: (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope,
    currentEvent: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly watchCalendarEvents: (
    calendarId: string,
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly watchCalendarList: (
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
}

export class GoogleCalendar extends Context.Service<
  GoogleCalendar,
  GoogleCalendarService
>()("GoogleCalendar") {}

// -- Errors --

const SeriesRefusalSchema = Schema.Union([
  Schema.Struct({ reason: Schema.Literals(PLAIN_REFUSALS) }),
  Schema.Struct({
    originalStarts: Schema.Array(Schema.String),
    reason: Schema.Literals(NAMING_REFUSALS),
    seriesOnly: Schema.optional(Schema.Literal(true)),
  }),
]);

export class GoogleApiError extends Schema.TaggedError<GoogleApiError>()(
  "GoogleApiError",
  {
    cause: Schema.Unknown,
    message: Schema.optional(Schema.String),
    /**
     * A write Kompose won't make to a series, refused before anything
     * changed: it won't work on a retry either.
     */
    refusal: Schema.optional(SeriesRefusalSchema),
  }
) {
  /**
   * What the API sends the client; `cause` stays on the server. A
   * refusal's `data` says which, for the client to word.
   */
  get publicError() {
    return this.refusal
      ? ({
          code: "BAD_REQUEST",
          data: this.refusal,
          message: refusalMessage(this.refusal),
        } as const)
      : ({
          code: "BAD_GATEWAY",
          message: "Google Calendar request failed. Try again.",
        } as const);
  }
}

export class GoogleCalendarZodError extends Schema.TaggedError<GoogleCalendarZodError>()(
  "GoogleCalendarZodError",
  {
    cause: Schema.Unknown,
  }
) {}

// -- Implementation --

export function makeGoogleCalendarService(
  accessToken: string
): GoogleCalendarService {
  const client = new GoogleCalendarClient({ accessToken });

  // --- Calendar Methods ---

  const listCalendars = Effect.fn("GoogleCalendar.listCalendars")(function* () {
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.list(),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    if (!response.items) {
      return [];
    }

    return z.array(CalendarSchema).parse(response.items);
  });

  const listCalendarIds = Effect.fn("GoogleCalendar.listCalendarIds")(
    function* () {
      const calendars = yield* listCalendars();
      return Array.from(
        new Set(
          calendars
            .map((calendar) => calendar.id)
            .filter((id): id is string => Boolean(id))
        )
      );
    }
  );

  const getCalendar = Effect.fn("GoogleCalendar.getCalendar")(function* (
    calendarId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.retrieve(calendarId),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const createCalendar = Effect.fn("GoogleCalendar.createCalendar")(function* (
    calendar: CreateCalendar
  ) {
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.create(calendar),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const updateCalendar = Effect.fn("GoogleCalendar.updateCalendar")(function* (
    calendarId: string,
    calendar: CreateCalendar
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.update(calendarId, calendar),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const deleteCalendar = Effect.fn("GoogleCalendar.deleteCalendar")(function* (
    calendarId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.delete(calendarId),
      catch: (cause) => new GoogleApiError({ cause }),
    });
  });

  const parseWatchChannelResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = z
        .object({
          expiration: z.string().optional(),
          id: z.string().min(1),
          resourceId: z.string().min(1),
        })
        .safeParse(response);

      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      return {
        channelId: parsed.data.id,
        expiration: parsed.data.expiration,
        resourceId: parsed.data.resourceId,
      } satisfies GoogleWatchChannelResult;
    });

  const watchCalendarList = Effect.fn("GoogleCalendar.watchCalendarList")(
    function* (channel: GoogleWatchChannelInput) {
      yield* Effect.annotateCurrentSpan("channelId", channel.id);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.users.me.calendarList.watch({
            address: channel.address,
            expiration: channel.expiration,
            id: channel.id,
            token: channel.token,
            type: "web_hook",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* parseWatchChannelResponse(response);
    }
  );

  const watchCalendarEvents = Effect.fn("GoogleCalendar.watchCalendarEvents")(
    function* (calendarId: string, channel: GoogleWatchChannelInput) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("channelId", channel.id);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.watch(calendarId, {
            address: channel.address,
            expiration: channel.expiration,
            id: channel.id,
            token: channel.token,
            type: "web_hook",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* parseWatchChannelResponse(response);
    }
  );

  const stopWatch = Effect.fn("GoogleCalendar.stopWatch")(function* (params: {
    channelId: string;
    resourceId: string;
  }) {
    yield* Effect.annotateCurrentSpan("channelId", params.channelId);
    yield* Effect.annotateCurrentSpan("resourceId", params.resourceId);
    yield* Effect.tryPromise({
      try: () =>
        client.stopWatching.stopWatching({
          id: params.channelId,
          resourceId: params.resourceId,
        }),
      catch: (cause) => new GoogleApiError({ cause }),
    });
  });

  // --- Event Methods ---

  const listEvents = Effect.fn("GoogleCalendar.listEvents")(function* (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    // Expanded recurring events can exceed one page; request the maximum and follow page tokens.
    const items: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.list(calendarId, {
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500,
            pageToken,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
      items.push(...(response.items ?? []));
      pageToken = response.nextPageToken ?? undefined;
    } while (pageToken);

    const parsed = z.array(EventSchema).safeParse(items);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const getEvent = Effect.fn("GoogleCalendar.getEvent")(function* (
    calendarId: string,
    eventId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    const response = yield* Effect.tryPromise({
      try: () => client.calendars.events.retrieve(eventId, { calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = EventSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const createEvent = Effect.fn("GoogleCalendar.createEvent")(function* (
    calendarId: string,
    event: CreateEvent
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan(
      "eventType",
      event.eventType ?? "default"
    );
    const conferenceDataVersion = getConferenceDataVersion(event);
    const response = yield* Effect.tryPromise({
      try: () =>
        client.calendars.events.create(calendarId, {
          ...event,
          ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
        }),
      catch: (cause) => {
        logGoogleEventUpdateFailure({
          operation: "create",
          calendarId,
          event,
          cause,
        });
        return new GoogleApiError({ cause });
      },
    });

    const parsed = EventSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const parseEventResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return parsed.data;
    });

  const updateEventThis = (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      const payload = buildThisOccurrenceUpdatePayload(event, currentEvent);

      yield* Effect.annotateCurrentSpan(
        "eventType",
        payload.eventType ?? "default"
      );
      const conferenceDataVersion = getConferenceDataVersion(payload);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            ...payload,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId,
            scope: "this",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      return yield* parseEventResponse(response);
    });

  /**
   * `master`'s exceptions, sorted by `sortExceptions`. Listed by iCalUID,
   * which returns only the master and its exceptions, so an endless
   * series isn't expanded.
   */
  const exceptionsOf = (calendarId: string, master: Event) =>
    Effect.gen(function* () {
      const iCalUID = master.iCalUID;
      if (!iCalUID) {
        // Google gives every event one; without it the exceptions can't
        // be checked, so nothing is written.
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Series has no iCalUID") })
        );
      }
      const items: unknown[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.list(calendarId, {
              iCalUID,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        items.push(...(response.items ?? []));
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      const parsed = SeriesListingSchema.safeParse(items);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return sortExceptions(parsed.data, master);
    });

  /**
   * An edit through `occurrence` applied to its series: the series' fields
   * plus only those the user changed, so an occurrence's own title or
   * notes aren't written onto every meeting.
   */
  const asSeriesEdit = (
    edited: CreateEvent,
    occurrence: Event,
    master: Event
  ) => {
    const changes = changedFields(edited, occurrence);
    return { changes, event: { ...sanitizeEventPayload(master), ...changes } };
  };

  /**
   * The rule an Entire series save writes, once what it would cost the
   * occurrences changed or deleted on their own is checked: a deleted one
   * stays deleted as a skip where its meeting now is (`deletedSlots`), as
   * Google brings it back when the start moves; one changed whose changes
   * Google would undo is refused before writing (`seriesChangeRefusal`).
   */
  const keptOccurrences = (params: {
    calendarId: string;
    changes: Partial<CreateEvent>;
    edited: CreateEvent;
    master: Event;
    opened: Event;
    times: { end: Event["end"]; start: Event["start"] };
  }) =>
    Effect.gen(function* () {
      const { master, times } = params;
      const zone = seriesZoneOf(master);
      const rule = params.edited.recurrence ?? master.recurrence ?? [];
      const movesStart = !sameTime(times.start, master.start, zone);
      const movesSlots =
        movesStart ||
        JSON.stringify(rule) !== JSON.stringify(master.recurrence ?? []);
      if (!(movesSlots || !sameLength(times, master, zone))) {
        return rule;
      }
      const { cancelled, changed } = yield* exceptionsOf(
        params.calendarId,
        master
      );
      const recurrence = movesStart
        ? skipping(
            rule,
            deletedSlots({ cancelled, master, start: times.start }),
            zone
          )
        : rule;
      const refusal = seriesChangeRefusal({
        cancelled,
        changed,
        changes: params.changes,
        master,
        movesSlots,
        opened: params.opened,
        recurrence,
        saved: params.edited.recurrence,
        times,
      });
      if (refusal) {
        return yield* Effect.fail(refused(refusal));
      }
      return recurrence;
    });

  const updateEventAll = (
    calendarId: string,
    edited: CreateEvent,
    currentEvent: Event,
    master: Event
  ) =>
    Effect.gen(function* () {
      const zone = seriesZoneOf(master);
      const { changes, event } = asSeriesEdit(edited, currentEvent, master);
      const times = entireSeriesTimes(edited, currentEvent, master);
      if (movesSeveralADay(master, times.start, edited, currentEvent)) {
        return yield* Effect.fail(refused({ reason: "severalTimesADay" }));
      }

      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None").
      const recurrence = yield* keptOccurrences({
        calendarId,
        changes,
        edited,
        master,
        opened: currentEvent,
        times,
      });
      const movesStart = !sameTime(times.start, master.start, zone);

      const payload: CreateEvent = {
        ...event,
        end: times.end,
        recurrence,
        start: times.start,
      };
      yield* Effect.annotateCurrentSpan(
        "eventType",
        payload.eventType ?? "default"
      );
      const conferenceDataVersion = getConferenceDataVersion(payload);

      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...payload,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: master.id,
            scope: "all",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      const updated = yield* parseEventResponse(response);
      // A new start cancels the opened occurrence's own times with the
      // rest of its exception; there's nothing of its own left to write.
      if (!movesStart) {
        yield* applyToOpened({
          calendarId,
          changes,
          edited,
          master,
          occurrence: currentEvent,
        });
      }
      return updated;
    });

  /**
   * Google keeps an occurrence's own values when its series changes, so an
   * edit through an occurrence with its own (moved and renamed, say) is
   * also written to it when it changes one of those fields or its times.
   */
  const applyToOpened = (params: {
    calendarId: string;
    changes: Partial<CreateEvent>;
    edited: CreateEvent;
    master: Event;
    occurrence: Event;
  }) => {
    const { changes, edited, master, occurrence } = params;
    const zone = seriesZoneOf(master);
    const own = changesOwnTo(occurrence, master, zone);
    const times = timesOnOwnDay(occurrence, edited, master);
    const retimed = !keepsTimes(times, occurrence, zone);
    const overridden = Object.keys(changes).some((field) => field in own);
    // One that is just the series' own follows the series.
    const setsOwn = Object.keys(own).length > 0;
    if (!(occurrence.recurringEventId && setsOwn && (overridden || retimed))) {
      return Effect.void;
    }
    return updateEventThis(
      params.calendarId,
      occurrence.id,
      { ...sanitizeEventPayload(occurrence), ...changes, ...times },
      occurrence
    ).pipe(Effect.asVoid);
  };

  const updateEventFollowing = (
    calendarId: string,
    event: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, currentEvent);
      if (!master.recurrence) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const startIso =
        currentEvent.originalStartTime?.dateTime ??
        currentEvent.originalStartTime?.date ??
        currentEvent.start.dateTime ??
        currentEvent.start.date;
      const masterStartIso = master.start.dateTime ?? master.start.date;

      if (!(startIso && masterStartIso)) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(startIso);
      const masterStart = new Date(masterStartIso);

      // First occurrence → "following" is the same as "all"
      if (occurrenceStart.getTime() <= masterStart.getTime()) {
        return yield* updateEventAll(calendarId, event, currentEvent, master);
      }

      const originalRecurrence = [...master.recurrence];
      const recurrence = event.recurrence?.length
        ? event.recurrence
        : master.recurrence;

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      const truncatedPayload = sanitizeEventPayload({
        ...master,
        recurrence: truncatedRecurrence,
      });
      yield* Effect.annotateCurrentSpan(
        "eventType",
        truncatedPayload.eventType ?? "default"
      );
      const truncatedConferenceDataVersion =
        getConferenceDataVersion(truncatedPayload);

      const truncateMasterResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...truncatedPayload,
            calendarId,
            ...(truncatedConferenceDataVersion
              ? { conferenceDataVersion: truncatedConferenceDataVersion }
              : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: master.id,
            scope: "following-truncate",
            event: truncatedPayload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      yield* parseEventResponse(truncateMasterResponse);

      const newSeriesPayload = sanitizeEventPayload({
        ...master,
        ...event,
        recurrence,
      });
      const newSeriesConferenceDataVersion =
        getConferenceDataVersion(newSeriesPayload);

      const restorePayload = sanitizeEventPayload({
        ...master,
        recurrence: originalRecurrence,
      });
      const restoreConferenceDataVersion =
        getConferenceDataVersion(restorePayload);

      const restoreMasterRecurrence = Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...restorePayload,
            calendarId,
            ...(restoreConferenceDataVersion
              ? { conferenceDataVersion: restoreConferenceDataVersion }
              : {}),
          }),
        catch: (restoreCause) => new GoogleApiError({ cause: restoreCause }),
      }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.asVoid
      );

      const createResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(calendarId, {
            ...newSeriesPayload,
            ...(newSeriesConferenceDataVersion
              ? { conferenceDataVersion: newSeriesConferenceDataVersion }
              : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "create",
            calendarId,
            event: newSeriesPayload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      }).pipe(
        Effect.catch((createError) =>
          // Best-effort rollback; keep the create failure even if restoring recurrence fails.
          restoreMasterRecurrence.pipe(Effect.andThen(Effect.fail(createError)))
        )
      );

      return yield* parseEventResponse(createResponse);
    });

  const updateEvent = Effect.fn("GoogleCalendar.updateEvent")(function* (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope,
    currentEvent: Event
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan("scope", scope);
    switch (scope) {
      case "this":
        return yield* updateEventThis(calendarId, eventId, event, currentEvent);
      case "all":
        return yield* updateEventAll(
          calendarId,
          event,
          currentEvent,
          yield* getMasterRecurrence(calendarId, currentEvent)
        );
      case "following":
        return yield* updateEventFollowing(calendarId, event, currentEvent);
      default:
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
        );
    }
  });

  /** Cancel an occurrence without affecting the rest of its series. */
  const deleteEventThis = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);

      // Preserve the occurrence identity and time bounds when cancelling an exception.
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            calendarId,
            status: "cancelled",
            start: instance.start,
            end: instance.end,
            ...(instance.originalStartTime && {
              originalStartTime: instance.originalStartTime,
            }),
            ...(instance.recurringEventId && {
              recurringEventId: instance.recurringEventId,
            }),
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
    }).pipe(Effect.asVoid);

  const deleteEventAll = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);

      const isRecurring = Boolean(
        instance.recurringEventId || instance.recurrence?.length
      );

      let masterId = eventId;
      if (instance.recurringEventId) {
        const master = yield* getMasterRecurrence(calendarId, instance);
        masterId = master.id;
      } else if (!isRecurring) {
        return yield* Effect.tryPromise({
          try: () => client.calendars.events.delete(eventId, { calendarId }),
          catch: (cause) => new GoogleApiError({ cause }),
        }).pipe(Effect.asVoid);
      }

      return yield* Effect.tryPromise({
        try: () => client.calendars.events.delete(masterId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(Effect.asVoid);
    });

  const deleteEventFollowing = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);

      const isRecurring = Boolean(
        instance.recurringEventId || instance.recurrence?.length
      );
      if (!isRecurring) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error(
              "Cannot use recurrence scope for a non-recurring event"
            ),
          })
        );
      }

      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const originalStartIso =
        instance.originalStartTime?.dateTime ??
        instance.originalStartTime?.date ??
        instance.start.dateTime ??
        instance.start.date;

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(originalStartIso);

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: truncatedRecurrence,
            }),
            calendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
    }).pipe(Effect.asVoid);

  const deleteEvent = Effect.fn("GoogleCalendar.deleteEvent")(function* (
    calendarId: string,
    eventId: string,
    scope: RecurrenceScope
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan("scope", scope);
    switch (scope) {
      case "this":
        return yield* deleteEventThis(calendarId, eventId);
      case "all":
        return yield* deleteEventAll(calendarId, eventId);
      case "following":
        return yield* deleteEventFollowing(calendarId, eventId);
      default:
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
        );
    }
  });

  const moveSingleEvent = Effect.fn("GoogleCalendar.moveSingleEvent")(
    function* (
      calendarId: string,
      eventId: string,
      destinationCalendarId: string
    ) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventId", eventId);
      yield* Effect.annotateCurrentSpan(
        "destinationCalendarId",
        destinationCalendarId
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.move(eventId, {
            calendarId,
            destination: destinationCalendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      return parsed.data;
    }
  );

  const moveEvent = Effect.fn("GoogleCalendar.moveEvent")(function* (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string,
    scope: RecurrenceScope
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan(
      "destinationCalendarId",
      destinationCalendarId
    );
    yield* Effect.annotateCurrentSpan("scope", scope);
    if (scope === "this") {
      return yield* moveSingleEvent(calendarId, eventId, destinationCalendarId);
    }

    const instance = yield* getEvent(calendarId, eventId);

    const isRecurring = Boolean(
      instance.recurringEventId || instance.recurrence?.length
    );
    if (!isRecurring) {
      return yield* Effect.fail(
        new GoogleApiError({
          cause: new Error(
            "Cannot use recurrence scope for a non-recurring event"
          ),
        })
      );
    }

    if (scope === "all") {
      const master = yield* getMasterRecurrence(calendarId, instance);
      return yield* moveSingleEvent(
        calendarId,
        master.id,
        destinationCalendarId
      );
    }

    if (scope === "following") {
      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const originalStartIso =
        instance.originalStartTime?.dateTime ??
        instance.originalStartTime?.date ??
        instance.start.dateTime ??
        instance.start.date;

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(originalStartIso);

      // 1) Cut off the original series up to the edited occurrence.
      const originalRecurrence = [...master.recurrence];
      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      const truncatedMasterResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: truncatedRecurrence,
            }),
            calendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const truncatedMasterParsed = EventSchema.safeParse(
        truncatedMasterResponse
      );
      if (!truncatedMasterParsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: truncatedMasterParsed.error })
        );
      }

      // 2) Create a new series in the destination calendar starting at this occurrence.
      const newSeriesPayload = sanitizeEventPayload({
        ...master,
        ...instance,
        start: instance.start,
        end: instance.end,
        recurrence: master.recurrence,
      });

      const restoreMasterRecurrence = Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: originalRecurrence,
            }),
            calendarId,
          }),
        catch: (restoreCause) => new GoogleApiError({ cause: restoreCause }),
      }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.asVoid
      );

      const createResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(
            destinationCalendarId,
            newSeriesPayload
          ),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(
        Effect.catch((createError) =>
          // Best-effort rollback; keep the create failure even if restoring recurrence fails.
          restoreMasterRecurrence.pipe(Effect.andThen(Effect.fail(createError)))
        )
      );

      const createdParsed = EventSchema.safeParse(createResponse);
      if (!createdParsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: createdParsed.error })
        );
      }

      return createdParsed.data;
    }

    return yield* Effect.fail(
      new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
    );
  });

  const listColors = Effect.fn("GoogleCalendar.listColors")(function* () {
    const response = yield* Effect.tryPromise({
      try: () => client.listColors.listColors(),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = ColorsSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const getMasterRecurrence = Effect.fn("GoogleCalendar.getMasterRecurrence")(
    function* (calendarId: string, event: Event) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      const parsed = EventSchema.safeParse(event);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      const recurringEventId = parsed.data.recurringEventId;
      if (!recurringEventId) {
        if (!parsed.data.recurrence) {
          return yield* Effect.fail(
            new GoogleApiError({
              cause: new Error("Event is not a recurring event"),
            })
          );
        }
        return parsed.data;
      }

      const master = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.retrieve(recurringEventId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsedMaster = EventSchema.safeParse(master);
      if (!parsedMaster.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsedMaster.error })
        );
      }

      return parsedMaster.data;
    }
  );

  return {
    listCalendars,
    listCalendarIds,
    getCalendar,
    createCalendar,
    updateCalendar,
    deleteCalendar,
    listEvents,
    getEvent,
    createEvent,
    updateEvent,
    moveEvent,
    deleteEvent,
    listColors,
    watchCalendarList,
    watchCalendarEvents,
    stopWatch,
    getMasterRecurrence,
  };
}

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, makeGoogleCalendarService(accessToken));
