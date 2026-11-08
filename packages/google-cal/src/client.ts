import { Context, Effect, Exit, Layer, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  carryCount,
  carryCountExactly,
  countOf,
  followingCutUnsure,
  followingSplitBlocked,
  sanitizeEventPayload,
  seriesMeetsAt,
  splitAddedDays,
  truncateRecurrenceForFollowing,
} from "./recurrence-utils";
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
  ownChanges,
  placeInNewSeries,
  refusalMessage,
  type SeriesRefusal,
  sameTime,
} from "./series-edits";
import { seriesTimesForEdit } from "./series-times";
import {
  matchRecurrenceToStart,
  meetsSeveralTimesADay,
  startInstant,
  untilMoment,
} from "./until";

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
 * A series' start and end moved to one of its occurrences' original slot
 * (`originalStart`), keeping the series' length and zone.
 */
function seriesSlotAt(
  master: Event,
  originalStart: string
): { end: Event["end"]; start: Event["start"] } {
  if (master.start.date && master.end.date) {
    const days = Math.max(
      1,
      Temporal.PlainDate.from(master.start.date).until(master.end.date).days
    );
    const day = Temporal.PlainDate.from(originalStart.slice(0, 10));
    return {
      end: { date: day.add({ days }).toString() },
      start: { date: day.toString() },
    };
  }
  const zone = seriesZoneOf(master);
  const from = startInstant(master.start, zone);
  const to = startInstant(master.end, zone);
  const length = from && to ? from.until(to) : new Temporal.Duration();
  const start = Temporal.Instant.from(originalStart);
  const written = (moment: Temporal.Instant) =>
    moment
      .toZonedDateTimeISO(zone)
      .toString({ smallestUnit: "second", timeZoneName: "never" });
  return {
    end: {
      dateTime: written(start.add(length)),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: { dateTime: written(start), timeZone: master.start.timeZone },
  };
}

/** The zone a series' days are counted in. */
function seriesZoneOf(master: { start: { timeZone?: string } }): string {
  return master.start.timeZone ?? "UTC";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `recurrence` with the occurrences at `starts` (original starts, as
 * Google writes them) skipped. Unchanged without a rule to skip from.
 */
function skipping(recurrence: string[], starts: string[]): string[] {
  if (
    starts.length === 0 ||
    !recurrence.some((line) => line.startsWith("RRULE:"))
  ) {
    return recurrence;
  }
  const dates = starts
    .filter((start) => DATE_ONLY.test(start))
    .map((start) => start.replace(/-/g, ""));
  const times = starts
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

/** A refusal, as the service fails with it. */
function refused(refusal: SeriesRefusal): GoogleApiError {
  return new GoogleApiError({
    cause: new Error(refusalMessage(refusal)),
    refusal,
  });
}

/**
 * Refuses "This and following" where a new series can't start: at an
 * added meeting, or in a series with several rules (the apps don't offer
 * it there either). Null when the split is fine.
 */
function splitBlockedError(
  master: Event,
  originalStart: string
): GoogleApiError | null {
  const blocked = followingSplitBlocked({
    masterRecurrence: master.recurrence,
    masterStart: master.start,
    originalStart,
    seriesZone: seriesZoneOf(master),
  });
  return blocked ? refused({ reason: blocked }) : null;
}

const RULE_UNTIL = /[:;]UNTIL=([^;]+)/;

/**
 * A start's moment: its date-time (one without an offset read in its own
 * time zone, or `zone`, as Google does), or the start of its date in
 * `zone`; null when it doesn't parse.
 */
function firstMoment(
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): Temporal.Instant | null {
  if (start.dateTime) {
    return startInstant(start, zone);
  }
  try {
    return start.date
      ? Temporal.PlainDate.from(start.date)
          .toZonedDateTime({ timeZone: zone })
          .toInstant()
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether an edit through `occurrence` is to its series' first meeting:
 * the master itself, or the occurrence first in its place.
 */
function opensSeries(occurrence: Event, master: Event): boolean {
  if (!occurrence.recurringEventId) {
    return true;
  }
  const zone = seriesZoneOf(master);
  const original = firstMoment(
    occurrence.originalStartTime ?? occurrence.start,
    zone
  );
  const first = firstMoment(master.start, zone);
  return Boolean(
    original && first && Temporal.Instant.compare(original, first) <= 0
  );
}

/**
 * Whether a new series' rule ends (UNTIL) before its own first meeting:
 * Google would keep only that meeting.
 */
function endsBeforeStart(
  recurrence: string[],
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): boolean {
  const until = recurrence
    .find((line) => line.startsWith("RRULE:"))
    ?.match(RULE_UNTIL)?.[1];
  const last = until ? untilMoment(until, zone) : null;
  const first = firstMoment(start, zone);
  return Boolean(last && first && Temporal.Instant.compare(last, first) < 0);
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
 * A series' rule as written with its `start`: UNTIL and EXDATE/RDATE in
 * the start's form, skipped occurrences at its time, all counted on the
 * series' days in its zone. Applied to whatever the series ends up with,
 * the client's rule or its kept one, so a rule a client lined up with an
 * occurrence (rescheduled to 11:00, say) can't skip the wrong times.
 */
function ruleForStart(
  rule: string[] | undefined,
  master: { start: { date?: string; dateTime?: string; timeZone?: string } },
  start: { date?: string; dateTime?: string; timeZone?: string },
  /**
   * A split's original start: the new series' first meeting, whose time
   * its COUNT counts from when it's made all day.
   */
  splitAt?: string
): string[] | undefined {
  const zone = repeatZone(master, start);
  const splitClock =
    splitAt && !DATE_ONLY.test(splitAt)
      ? Temporal.Instant.from(splitAt).toZonedDateTimeISO(zone).toPlainTime()
      : null;
  const days =
    start.date && splitClock
      ? { firstDay: Temporal.PlainDate.from(start.date), firstTime: splitClock }
      : undefined;
  return rule && matchRecurrenceToStart(rule, start, zone, master.start, days);
}

/**
 * `time` in the series' zone when it has one, the same moment: a
 * date-time without an offset is read in its own zone (as Google does)
 * and written with the series' offset, so relabelling it can't move it.
 */
function inSeriesZone<
  T extends { date?: string; dateTime?: string; timeZone?: string },
>(time: T, series: { timeZone?: string }): T {
  if (!(time.dateTime && series.timeZone)) {
    return time;
  }
  const moment = startInstant(time, series.timeZone);
  const dateTime = moment
    ? moment
        .toZonedDateTimeISO(series.timeZone)
        .toString({ smallestUnit: "second", timeZoneName: "never" })
    : time.dateTime;
  return { ...time, dateTime, timeZone: series.timeZone };
}

/**
 * A start as a series' slot: a date, or a date-time with the series'
 * offset (one Google wrote without an offset read in its own zone). Null
 * when it has neither.
 */
function slotOf(
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): string | null {
  if (start.date) {
    return start.date;
  }
  return (
    startInstant(start, zone)
      ?.toZonedDateTimeISO(zone)
      .toString({ smallestUnit: "second", timeZoneName: "never" }) ?? null
  );
}

/** An occurrence's original start: the slot it holds in its series. */
function originalStartOf(occurrence: Event, zone: string): string | null {
  return slotOf(occurrence.originalStartTime ?? occurrence.start, zone);
}

/**
 * A series' times after an "Entire series" edit made through
 * `occurrence`. Times left as the occurrence had them leave the series'
 * alone (an occurrence moved on its own doesn't move it). An edit to the
 * series' first meeting moves its date; through any other occurrence the
 * series keeps its first date (a date move there is "This and following"
 * only). Google repeats a series in its start's zone, so the edit's times
 * are read in the series' zone (the same moments).
 */
function entireSeriesTimes(
  edited: CreateEvent,
  occurrence: Event,
  master: Event
): { end: Event["end"]; start: Event["start"] } {
  const kept = { end: master.end, start: master.start };
  if (keepsTimes(edited, occurrence, seriesZoneOf(master))) {
    return kept;
  }
  const end = inSeriesZone(edited.end, master.end);
  const start = inSeriesZone(edited.start, master.start);
  if (opensSeries(occurrence, master)) {
    return { end, start };
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
 * Whether `start` moves the time of day of a series that meets several
 * times a day. It has a rule per time, so its start's time can't move
 * without moving one of them onto another's, or off its own.
 */
function movesSeveralADay(master: Event, start: Event["start"]): boolean {
  const zone = seriesZoneOf(master);
  const clockOf = (time: Event["start"]) =>
    time.dateTime
      ? startInstant(time, zone)?.toZonedDateTimeISO(zone).toPlainTime()
      : undefined;
  const from = clockOf(master.start);
  const to = clockOf(start);
  return Boolean(
    from &&
      to &&
      Temporal.PlainTime.compare(from, to) !== 0 &&
      meetsSeveralTimesADay(master.recurrence ?? [], from)
  );
}

/** A slot's moment (a date's start, in `zone`); null if it doesn't parse. */
function slotMoment(slot: string, zone: string): Temporal.Instant | null {
  return firstMoment(
    DATE_ONLY.test(slot) ? { date: slot } : { dateTime: slot },
    zone
  );
}

/**
 * `master`'s exceptions among `events` (it and its exceptions, as Google
 * lists them), all or those after `after` (an original start): the
 * original starts of those cancelled, and those moved or edited.
 */
function sortExceptions(events: Event[], master: Event, after: string | null) {
  const zone = seriesZoneOf(master);
  const from = after ? slotMoment(after, zone) : null;
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
    if (from && Temporal.Instant.compare(moment, from) <= 0) {
      continue;
    }
    if (event.status === "cancelled") {
      cancelled.push(originalStart);
    } else {
      changed.push({ occurrence: event, originalStart });
    }
  }
  return { cancelled, changed };
}

/** An occurrence's own changes to put back on a new series, and where. */
interface CarriedOccurrence {
  /** Its slot in the new series (its original start there). */
  at: string;
  changes: Partial<CreateEvent>;
}

/**
 * `occurrence`'s own changes (see `ownChanges`) less the fields `edited`
 * sets for its whole series, which the series carries.
 */
function changesOwnTo(
  occurrence: Event,
  master: Event,
  edited: Partial<CreateEvent>,
  zone: string
): Partial<CreateEvent> {
  const originalStart = originalStartOf(occurrence, zone);
  if (!originalStart) {
    return {};
  }
  const own = ownChanges(
    occurrence,
    master,
    seriesSlotAt(master, originalStart),
    zone
  );
  return Object.fromEntries(
    Object.entries(own).filter(([field]) => !(field in edited))
  );
}

/**
 * The occurrences a "This and following" edit's new series carries, and
 * where: the opened one at its start, keeping what's its own (its times
 * only when the edit left them, since changed times start the new
 * series), and later ones changed on their own at their places in it.
 */
function followingOccurrences(params: {
  /** The fields the edit changed, which the new series carries. */
  changes: Partial<CreateEvent>;
  exceptions: { occurrence: Event; originalStart: string }[];
  /** Whether the edit left the opened occurrence's times. */
  keptTimes: boolean;
  master: Event;
  opened: Event;
  originalStart: string;
  /** The new series' start. */
  start: Event["start"];
}) {
  const { changes, master, originalStart, start } = params;
  const zone = seriesZoneOf(master);
  const own = changesOwnTo(params.opened, master, changes, zone);
  const { end: _end, start: _start, ...ownFields } = own;
  return [
    {
      at: slotOf(start, zone),
      changes: params.keptTimes ? own : ownFields,
      originalStart,
    },
    ...params.exceptions.map((exception) => ({
      at: placeInNewSeries({
        newStart: start,
        originalStart: exception.originalStart,
        splitStart: originalStart,
        zone,
      }),
      changes: changesOwnTo(exception.occurrence, master, changes, zone),
      originalStart: exception.originalStart,
    })),
  ];
}

/**
 * The occurrences a new series has to carry, each with changes of its
 * own, checked against it: Google keeps an occurrence's changes only at a
 * slot its series meets at. A refusal names, by original start, those
 * the new series has no meeting for, so nothing is written then.
 */
function placeCarried(params: {
  occurrences: {
    at: string | null;
    changes: Partial<CreateEvent>;
    originalStart: string;
  }[];
  recurrence: string[];
  start: Event["start"];
  zone: string;
}): CarriedOccurrence[] | SeriesRefusal {
  const carried: CarriedOccurrence[] = [];
  const lost: string[] = [];
  for (const { at, changes, originalStart } of params.occurrences) {
    if (Object.keys(changes).length === 0) {
      continue;
    }
    const meets =
      at &&
      seriesMeetsAt({
        recurrence: params.recurrence,
        seriesZone: params.zone,
        slot: at,
        start: params.start,
      });
    if (at && meets === true) {
      carried.push({ at, changes });
    } else {
      lost.push(originalStart);
    }
  }
  return lost.length > 0
    ? { originalStarts: lost, reason: "dropsChangedOccurrences" }
    : carried;
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
  Schema.Struct({
    reason: Schema.Literals([
      "severalRules",
      "addedOccurrence",
      "deleteFromAddedOccurrence",
      "endsBeforeStart",
      "countUnknown",
      "severalTimesADay",
    ]),
  }),
  Schema.Struct({
    originalStarts: Schema.Array(Schema.String),
    reason: Schema.Literal("dropsChangedOccurrences"),
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
   * The original starts of all a COUNT series' occurrences (it's finite),
   * cancelled ones too, as Google lists them: one rescheduled past the
   * split still has its place.
   */
  const listOccurrenceStarts = (calendarId: string, masterId: string) =>
    Effect.gen(function* () {
      const starts: string[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.instances(masterId, {
              calendarId,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        for (const item of response.items ?? []) {
          const start = item.originalStartTime ?? item.start;
          const value = start?.dateTime ?? start?.date;
          if (value) {
            starts.push(value);
          }
        }
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return starts;
    });

  /**
   * `master`'s occurrences changed one at a time, which Google keeps as
   * exceptions (not in the rule), all of them or those after `after` (an
   * original start): the original starts of those cancelled, and those
   * moved or edited. Listed by the series' iCalUID (its master and
   * exceptions only, so a series that never ends isn't expanded).
   */
  const exceptionsOf = (
    calendarId: string,
    master: Event,
    after: string | null
  ) =>
    Effect.gen(function* () {
      const items: unknown[] = [];
      let pageToken: string | undefined;
      while (master.iCalUID) {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.list(calendarId, {
              iCalUID: master.iCalUID,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        items.push(...(response.items ?? []));
        pageToken = response.nextPageToken ?? undefined;
        if (!pageToken) {
          break;
        }
      }
      const parsed = z.array(EventSchema).safeParse(items);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return sortExceptions(parsed.data, master, after);
    });

  /**
   * The rule a series' new part repeats with, from `originalStart` on: the
   * edit's own (`edited`), or the series' kept rule. Either way:
   * - a COUNT the user didn't change carries on (a five-time series moved
   *   to another day at its third runs three more, not five);
   * - occurrences `cancelled` after the split stay skipped, on their own
   *   days (a rule the edit moved to other days doesn't meet there);
   * - it's lined up with the new part's `start`.
   * Fails with a refusal, before anything is written, when its COUNT
   * can't be carried or it would end before that start.
   */
  const newSeriesRecurrence = (params: {
    calendarId: string;
    cancelled: string[];
    edited: string[] | undefined;
    master: Event;
    originalStart: string;
    start: Event["start"];
  }) =>
    Effect.gen(function* () {
      const { calendarId, master, originalStart, start } = params;
      // The new part repeats from the split on: added days before it stay
      // with the old part.
      const fromSplit = splitAddedDays(
        params.edited ?? master.recurrence ?? [],
        originalStart,
        seriesZoneOf(master),
        "from"
      );
      const counted = yield* carriedCount(
        calendarId,
        master,
        fromSplit,
        originalStart
      );
      if (!counted) {
        return yield* Effect.fail(refused({ reason: "countUnknown" }));
      }
      const recurrence =
        ruleForStart(
          skipping(counted, params.cancelled),
          master,
          start,
          originalStart
        ) ?? [];
      if (endsBeforeStart(recurrence, start, repeatZone(master, start))) {
        return yield* Effect.fail(refused({ reason: "endsBeforeStart" }));
      }
      return recurrence;
    });

  /**
   * `rule` (a split's new part) with the COUNT the user kept carried on:
   * the series' positions left after `originalStart`; unchanged when the
   * COUNT was changed or there is none. Null when what's left can't be
   * known.
   */
  const carriedCount = (
    calendarId: string,
    master: Event,
    rule: string[],
    originalStart: string
  ) =>
    Effect.gen(function* () {
      const count = countOf(master.recurrence);
      if (count === undefined || countOf(rule) !== count) {
        return rule;
      }
      const counting = {
        masterRecurrence: master.recurrence ?? [],
        originalStart,
        seriesStart:
          master.start.dateTime ?? master.start.date ?? originalStart,
        seriesZone: seriesZoneOf(master),
      };
      // A rule that can be read is counted without asking Google.
      const exact = carryCountExactly(rule, counting);
      if (exact) {
        return exact;
      }
      const starts = yield* listOccurrenceStarts(calendarId, master.id);
      return carryCount(rule, { ...counting, starts });
    });

  /** Writes a carried occurrence's own changes onto its new series' one. */
  const putBack = (
    calendarId: string,
    seriesId: string,
    carried: CarriedOccurrence
  ) =>
    Effect.gen(function* () {
      const listed = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.instances(seriesId, {
            calendarId,
            maxResults: 1,
            originalStart: carried.at,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
      const occurrence = yield* parseEventResponse(listed.items?.[0]);
      const payload = {
        ...sanitizeEventPayload(occurrence),
        ...carried.changes,
      };
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(occurrence.id, {
            ...payload,
            calendarId,
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: occurrence.id,
            scope: "following-carry",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });
    });

  /**
   * Splits `master` at `originalStart` into `newSeries` (in
   * `destinationCalendarId`), whole or not at all. The new series is
   * created first, under an id chosen here, with the `carried`
   * occurrences put back on it; only then is the old series cut to end
   * before the split (which makes Google drop its occurrences after it).
   * A failure before the cut deletes the new series, so the old one is as
   * it was. A failed cut is checked by reading the series back: its rule
   * unchanged, the new one is deleted; changed, the split stands;
   * unknown, both are left (an occurrence shown twice beats one lost) and
   * the failure kept.
   */
  const splitSeries = (params: {
    calendarId: string;
    carried: CarriedOccurrence[];
    destinationCalendarId: string;
    master: Event;
    newSeries: CreateEvent;
    originalStart: string;
  }) =>
    Effect.gen(function* () {
      const { calendarId, destinationCalendarId, master, newSeries } = params;
      yield* Effect.annotateCurrentSpan(
        "eventType",
        newSeries.eventType ?? "default"
      );
      // Google takes an id of base32hex characters (0-9, a-v).
      const seriesId = crypto.randomUUID().replaceAll("-", "");
      const discardNew = Effect.tryPromise({
        try: () =>
          client.calendars.events.delete(seriesId, {
            calendarId: destinationCalendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(Effect.ignore);

      const conferenceDataVersion = getConferenceDataVersion(newSeries);
      const created = yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.create(destinationCalendarId, {
              ...newSeries,
              id: seriesId,
              ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
            }),
          catch: (cause) => {
            logGoogleEventUpdateFailure({
              operation: "create",
              calendarId: destinationCalendarId,
              event: newSeries,
              cause,
            });
            return new GoogleApiError({ cause });
          },
        });
        const series = yield* parseEventResponse(response);
        for (const carried of params.carried) {
          yield* putBack(destinationCalendarId, seriesId, carried);
        }
        return series;
      }).pipe(Effect.onError(() => discardNew));

      const cutRecurrence = truncateRecurrenceForFollowing(
        master.recurrence ?? [],
        params.originalStart,
        seriesZoneOf(master),
        master.start.dateTime ?? master.start.date
      );
      const cutPayload = sanitizeEventPayload({
        ...master,
        recurrence: cutRecurrence,
      });
      const cutConferenceDataVersion = getConferenceDataVersion(cutPayload);
      const cut = yield* Effect.exit(
        Effect.tryPromise({
          try: () =>
            client.calendars.events.update(master.id, {
              ...cutPayload,
              calendarId,
              ...(cutConferenceDataVersion
                ? { conferenceDataVersion: cutConferenceDataVersion }
                : {}),
            }),
          catch: (cause) => {
            logGoogleEventUpdateFailure({
              operation: "update",
              calendarId,
              eventId: master.id,
              scope: "following-truncate",
              event: cutPayload,
              cause,
            });
            return new GoogleApiError({ cause });
          },
        })
      );
      if (Exit.isFailure(cut)) {
        const current = yield* Effect.exit(getEvent(calendarId, master.id));
        if (Exit.isFailure(current)) {
          return yield* Effect.failCause(cut.cause);
        }
        if (
          JSON.stringify(current.value.recurrence) ===
          JSON.stringify(master.recurrence)
        ) {
          yield* discardNew;
          return yield* Effect.failCause(cut.cause);
        }
      }
      return created;
    });

  /**
   * An edit made through `occurrence` as it applies to its series: the
   * series' own fields, with those the user changed (the edit differs
   * from the occurrence it was made from) taken from the edit, so an
   * occurrence's own title or notes aren't written onto every meeting.
   */
  const asSeriesEdit = (
    edited: CreateEvent,
    occurrence: Event,
    master: Event
  ) => {
    const changes = changedFields(edited, occurrence);
    return { changes, event: { ...sanitizeEventPayload(master), ...changes } };
  };

  const updateEventAll = (
    calendarId: string,
    edited: CreateEvent,
    currentEvent: Event,
    master: Event
  ) =>
    Effect.gen(function* () {
      const zone = seriesZoneOf(master);
      const { event } = asSeriesEdit(edited, currentEvent, master);
      const times = entireSeriesTimes(edited, currentEvent, master);
      if (movesSeveralADay(master, times.start)) {
        return yield* Effect.fail(refused({ reason: "severalTimesADay" }));
      }

      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None"). Either way in the form the series' start takes.
      const recurrence =
        ruleForStart(
          edited.recurrence ?? master.recurrence,
          master,
          times.start
        ) ?? [];
      // Google drops an occurrence's own changes when the series no
      // longer meets at its original slot: refused before that happens.
      const movesSlots =
        !sameTime(times.start, master.start, zone) ||
        JSON.stringify(recurrence) !== JSON.stringify(master.recurrence ?? []);
      if (movesSlots) {
        const { changed } = yield* exceptionsOf(calendarId, master, null);
        const lost = changed
          .map(({ originalStart }) => originalStart)
          .filter(
            (slot) =>
              seriesMeetsAt({
                recurrence,
                seriesZone: repeatZone(master, times.start),
                slot,
                start: times.start,
              }) !== true
          );
        if (lost.length > 0) {
          return yield* Effect.fail(
            refused({ originalStarts: lost, reason: "dropsChangedOccurrences" })
          );
        }
      }

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

      return yield* parseEventResponse(response);
    });

  const updateEventFollowing = (
    calendarId: string,
    edited: CreateEvent,
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
      // From the first meeting, "following" is the same as "all", from its
      // (possibly moved) date.
      if (opensSeries(currentEvent, master)) {
        return yield* updateEventAll(calendarId, edited, currentEvent, master);
      }
      const zone = seriesZoneOf(master);
      const originalStart = originalStartOf(currentEvent, zone);
      if (!originalStart) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }
      const blocked = splitBlockedError(master, originalStart);
      if (blocked) {
        return yield* Effect.fail(blocked);
      }
      const { changes, event } = asSeriesEdit(edited, currentEvent, master);
      // Times left as the occurrence had them: the new series starts at
      // its original slot, at the series' time and length (it keeps its
      // own move as an exception). Otherwise at the edit's, read once in
      // the series' zone (Google repeats a series in its start's zone).
      const keptTimes = keepsTimes(edited, currentEvent, zone);
      const times = keptTimes
        ? seriesSlotAt(master, originalStart)
        : {
            end: inSeriesZone(edited.end, master.end),
            start: inSeriesZone(edited.start, master.start),
          };
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      // Left out keeps the series' pattern (its UNTIL in the form the new
      // start takes); an empty list ends it ("Repeat: None").
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        cancelled: exceptions.cancelled,
        edited: edited.recurrence,
        master,
        originalStart,
        start: times.start,
      });
      const carried = placeCarried({
        occurrences: followingOccurrences({
          changes,
          exceptions: exceptions.changed,
          keptTimes,
          master,
          opened: currentEvent,
          originalStart,
          start: times.start,
        }),
        recurrence,
        start: times.start,
        zone: repeatZone(master, times.start),
      });
      if (!Array.isArray(carried)) {
        return yield* Effect.fail(refused(carried));
      }
      return yield* splitSeries({
        calendarId,
        carried,
        destinationCalendarId: calendarId,
        master,
        // The new part keeps the series' zone (its times are in it).
        newSeries: { ...event, ...times, recurrence },
        originalStart,
      });
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

      const originalStartIso = originalStartOf(instance, seriesZoneOf(master));

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      // From an added meeting, in a rule whose end can't be told, a cut
      // might reach past where it really ended: refused, not guessed.
      if (
        followingCutUnsure({
          masterRecurrence: master.recurrence,
          masterStart: master.start,
          originalStart: originalStartIso,
          seriesZone: seriesZoneOf(master),
        })
      ) {
        return yield* Effect.fail(
          refused({ reason: "deleteFromAddedOccurrence" })
        );
      }

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        originalStartIso,
        seriesZoneOf(master),
        master.start.dateTime ?? master.start.date
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

  /**
   * Moves a series from one of its occurrences on to another calendar: the
   * old series ends before it, and a new one starts there.
   */
  const moveFollowingEvents = Effect.fn("GoogleCalendar.moveFollowingEvents")(
    function* (
      calendarId: string,
      instance: Event,
      destinationCalendarId: string
    ) {
      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const zone = seriesZoneOf(master);
      const originalStart = originalStartOf(instance, zone);
      if (!originalStart) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }
      const blocked = splitBlockedError(master, originalStart);
      if (blocked) {
        return yield* Effect.fail(blocked);
      }

      // The new series is the series from this occurrence's place on:
      // its original slot, with the series' own fields and length, and
      // the rest of a COUNT; its rule lined up with that start. The
      // occurrence itself and later ones changed on their own keep their
      // changes there.
      const slot = seriesSlotAt(master, originalStart);
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        cancelled: exceptions.cancelled,
        edited: undefined,
        master,
        originalStart,
        start: slot.start,
      });
      const carried = placeCarried({
        occurrences: [
          {
            at: originalStart,
            changes: changesOwnTo(instance, master, {}, zone),
            originalStart,
          },
          ...exceptions.changed.map((exception) => ({
            at: exception.originalStart,
            changes: changesOwnTo(exception.occurrence, master, {}, zone),
            originalStart: exception.originalStart,
          })),
        ],
        recurrence,
        start: slot.start,
        zone,
      });
      if (!Array.isArray(carried)) {
        return yield* Effect.fail(refused(carried));
      }
      const created = yield* splitSeries({
        calendarId,
        carried,
        destinationCalendarId,
        master,
        newSeries: sanitizeEventPayload({ ...master, ...slot, recurrence }),
        originalStart,
      });

      return created;
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
      return yield* moveFollowingEvents(
        calendarId,
        instance,
        destinationCalendarId
      );
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
