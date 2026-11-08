import { Context, Effect, Layer, Schema } from "effect";
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
import { seriesTimesForEdit } from "./series-times";
import { matchRecurrenceToStart, startInstant, untilMoment } from "./until";

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
  return {
    end: {
      dateTime: start.add(length).toString(),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: {
      dateTime: start.toString(),
      timeZone: master.start.timeZone,
    },
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
  if (!blocked) {
    return null;
  }
  const refusal =
    blocked === "severalRules"
      ? "This and following isn't available for a series with more than one rule."
      : "This and following isn't available for an occurrence added to the series on its own.";
  return new GoogleApiError({ cause: new Error(refusal), refusal });
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
 * Refuses a new series whose rule ends (UNTIL) before its own first
 * meeting: Google would keep only that meeting, and the old series would
 * already be cut. Null when it's fine (no UNTIL, or one at or after it).
 */
function endsBeforeStartError(
  recurrence: string[] | undefined,
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): GoogleApiError | null {
  const until = recurrence
    ?.find((line) => line.startsWith("RRULE:"))
    ?.match(RULE_UNTIL)?.[1];
  if (!until) {
    return null;
  }
  const last = untilMoment(until, zone);
  const first = firstMoment(start, zone);
  if (!(last && first && Temporal.Instant.compare(last, first) < 0)) {
    return null;
  }
  const refusal =
    "The repeat ends before this occurrence, so it can't start a new series here. Pick a later end.";
  return new GoogleApiError({ cause: new Error(refusal), refusal });
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

export class GoogleApiError extends Schema.TaggedError<GoogleApiError>()(
  "GoogleApiError",
  {
    cause: Schema.Unknown,
    message: Schema.optional(Schema.String),
    /**
     * A request Kompose won't make (a scope a series can't take), in
     * words for the user: it won't work on a retry either.
     */
    refusal: Schema.optional(Schema.String),
  }
) {
  /** What the API sends the client; `cause` stays on the server. */
  get publicError() {
    return this.refusal
      ? ({ code: "BAD_REQUEST", message: this.refusal } as const)
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
   * The original starts of `master`'s occurrences after `split` that were
   * cancelled one at a time. Google keeps those as cancelled exceptions,
   * not EXDATEs, so a new series from the split would bring them back.
   * Listed by the series' iCalUID (its master and exceptions only, so a
   * series that never ends isn't expanded).
   */
  const cancelledAfter = (
    calendarId: string,
    master: Event,
    split: Temporal.Instant
  ) =>
    Effect.gen(function* () {
      if (!master.iCalUID) {
        return [];
      }
      const zone = seriesZoneOf(master);
      const starts: string[] = [];
      let pageToken: string | undefined;
      do {
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
        for (const item of response.items ?? []) {
          const original = item.originalStartTime;
          const moment = original && firstMoment(original, zone);
          if (
            item.status === "cancelled" &&
            item.recurringEventId === master.id &&
            moment &&
            Temporal.Instant.compare(moment, split) > 0
          ) {
            starts.push(original.date ?? moment.toString());
          }
        }
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return starts;
    });

  /**
   * The rule a series' new part repeats with, from `originalStart` on: the
   * edit's own (`edited`), or the series' kept rule. Either way:
   * - a COUNT the user didn't change carries on (a five-time series moved
   *   to another day at its third runs three more, not five);
   * - occurrences cancelled after the split stay skipped, on their own
   *   days (a rule the edit moved to other days doesn't meet there);
   * - it's lined up with the new part's `start`.
   * Fails with a refusal, before anything is written, when it would end
   * before that start.
   */
  const newSeriesRecurrence = (params: {
    calendarId: string;
    edited: string[] | undefined;
    master: Event;
    originalStart: string;
    start: Event["start"];
  }) =>
    Effect.gen(function* () {
      const { calendarId, master, originalStart, start } = params;
      const zone = seriesZoneOf(master);
      // The new part repeats from the split on: added days before it stay
      // with the old part.
      const fromSplit = splitAddedDays(
        params.edited ?? master.recurrence ?? [],
        originalStart,
        zone,
        "from"
      );
      const counted = yield* carriedCount(
        calendarId,
        master,
        fromSplit,
        originalStart,
        start.dateTime ?? start.date ?? originalStart
      );
      const split = firstMoment({ dateTime: originalStart }, zone);
      const cancelled = split
        ? yield* cancelledAfter(calendarId, master, split)
        : [];
      const recurrence = ruleForStart(
        skipping(counted, cancelled),
        master,
        start,
        originalStart
      );
      const refusal = endsBeforeStartError(
        recurrence,
        start,
        repeatZone(master, start)
      );
      if (refusal) {
        return yield* Effect.fail(refusal);
      }
      return recurrence;
    });

  /**
   * `rule` (a split's new part) with the COUNT the user kept carried on:
   * the series' positions left after `originalStart`. Unchanged when the
   * COUNT was changed or there is none.
   */
  const carriedCount = (
    calendarId: string,
    master: Event,
    rule: string[],
    originalStart: string,
    /** The new part's start. */
    newStart: string
  ) =>
    Effect.gen(function* () {
      const count = countOf(master.recurrence);
      if (count === undefined || countOf(rule) !== count) {
        return rule;
      }
      const seriesStart =
        master.start.dateTime ?? master.start.date ?? originalStart;
      const zone = seriesZoneOf(master);
      // A rule that can be read is counted without asking Google.
      const exact = carryCountExactly(rule, {
        masterRecurrence: master.recurrence ?? [],
        originalStart,
        seriesStart,
        seriesZone: zone,
      });
      if (exact) {
        return exact;
      }
      const starts = yield* listOccurrenceStarts(calendarId, master.id);
      return carryCount(rule, {
        masterRecurrence: master.recurrence ?? [],
        newStart,
        originalStart,
        seriesStart,
        seriesZone: zone,
        starts,
      });
    });

  /**
   * Splits `master` at `originalStart`: its rule is cut to end before it,
   * then `newSeries` is created in `destinationCalendarId`. Once the cut
   * is written, any failure puts the master's rule back (best effort) and
   * keeps the failure, so a series isn't left cut without its new part.
   */
  const splitSeries = (params: {
    calendarId: string;
    destinationCalendarId: string;
    master: Event;
    newSeries: CreateEvent;
    originalStart: string;
  }) =>
    Effect.gen(function* () {
      const { calendarId, master, newSeries } = params;
      const writeMaster = (recurrence: string[], scope: string) => {
        const payload = sanitizeEventPayload({ ...master, recurrence });
        const conferenceDataVersion = getConferenceDataVersion(payload);
        return Effect.tryPromise({
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
              scope,
              event: payload,
              cause,
            });
            return new GoogleApiError({ cause });
          },
        });
      };
      yield* Effect.annotateCurrentSpan(
        "eventType",
        newSeries.eventType ?? "default"
      );
      const cut = yield* writeMaster(
        truncateRecurrenceForFollowing(
          master.recurrence ?? [],
          params.originalStart,
          seriesZoneOf(master),
          master.start.dateTime ?? master.start.date
        ),
        "following-truncate"
      );
      const conferenceDataVersion = getConferenceDataVersion(newSeries);
      const create = Effect.tryPromise({
        try: () =>
          client.calendars.events.create(params.destinationCalendarId, {
            ...newSeries,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "create",
            calendarId: params.destinationCalendarId,
            event: newSeries,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });
      return yield* parseEventResponse(cut).pipe(
        Effect.andThen(create),
        Effect.flatMap(parseEventResponse),
        Effect.onError(() =>
          writeMaster(master.recurrence ?? [], "following-restore").pipe(
            Effect.ignore
          )
        )
      );
    });

  /**
   * After a series is moved from one of its occurrences on, that
   * occurrence's own changes (a rescheduled time, a new title or notes)
   * are put back on the new series' first occurrence. Best effort: a
   * failure is logged, since the move itself has happened.
   */
  const keepOccurrenceInMovedSeries = (params: {
    calendarId: string;
    instance: Event;
    master: Event;
    seriesId: string;
    slot: { end: Event["end"]; start: Event["start"] };
  }) =>
    Effect.gen(function* () {
      const { calendarId, instance, master, seriesId, slot } = params;
      const zone = seriesZoneOf(master);
      const sameMoment = (a: Event["start"], b: Event["start"]) => {
        const from = firstMoment(a, zone);
        const to = firstMoment(b, zone);
        return Boolean(from && to && Temporal.Instant.compare(from, to) === 0);
      };
      // Only an occurrence that differs from the series gets written:
      // otherwise its first meeting would become an exception for nothing.
      const differs =
        !(
          sameMoment(instance.start, slot.start) &&
          sameMoment(instance.end, slot.end)
        ) ||
        (["summary", "description", "location", "colorId"] as const).some(
          (field) => (instance[field] ?? "") !== (master[field] ?? "")
        );
      if (!differs) {
        return;
      }
      const logged = (cause: unknown) => {
        logGoogleEventUpdateFailure({
          operation: "update",
          calendarId,
          eventId: seriesId,
          scope: "following-move-occurrence",
          event: sanitizeEventPayload(instance),
          cause,
        });
        return new GoogleApiError({ cause });
      };
      const originalStart = slot.start.dateTime ?? slot.start.date;
      const listed = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.instances(seriesId, {
            calendarId,
            maxResults: 1,
            originalStart,
          }),
        catch: logged,
      });
      const parsed = EventSchema.safeParse(listed.items?.[0]);
      if (!parsed.success) {
        logged(parsed.error);
        return;
      }
      const first = parsed.data;
      const payload = sanitizeEventPayload({
        ...first,
        colorId: instance.colorId,
        description: instance.description,
        end: instance.end,
        location: instance.location,
        start: instance.start,
        summary: instance.summary,
      });
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(first.id, { ...payload, calendarId }),
        catch: logged,
      });
    }).pipe(Effect.catch(() => Effect.void));

  const updateEventAll = (
    calendarId: string,
    edited: CreateEvent,
    currentEvent: Event,
    master: Event
  ) =>
    Effect.gen(function* () {
      // Google repeats a series in its start's zone: the edit's times are
      // read once, in the series' zone (the same moments).
      const event = {
        ...edited,
        end: inSeriesZone(edited.end, master.end),
        start: inSeriesZone(edited.start, master.start),
      };
      // An edit to the series' first meeting moves its date. Through any
      // other occurrence the series keeps its first date; a date move
      // there is "This and following" only.
      const times = opensSeries(currentEvent, master)
        ? { end: event.end, start: event.start }
        : (seriesTimesForEdit({
            editedEnd: event.end,
            editedStart: event.start,
            masterEnd: master.end,
            masterStart: master.start,
            occurrenceEnd: currentEvent.end,
            occurrenceStart: currentEvent.start,
          }) ?? { end: master.end, start: master.start });

      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None"). Either way in the form the series' start takes.
      const recurrence = ruleForStart(
        event.recurrence ?? master.recurrence,
        master,
        times.start
      );
      const payload = sanitizeEventPayload({
        ...master,
        ...event,
        start: times.start,
        end: times.end,
        recurrence,
      });
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

  /** The occurrence's original start, the series' place it holds. */
  const originalStartOf = (occurrence: Event) =>
    occurrence.originalStartTime?.dateTime ??
    occurrence.originalStartTime?.date ??
    occurrence.start.dateTime ??
    occurrence.start.date;

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
      const originalStart = originalStartOf(currentEvent);
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
      // Google repeats a series in its start's zone: the new part's times
      // are read once, in the series' zone (the same moments), and the
      // rule, the checks and the write all use them.
      const event = {
        ...edited,
        end: inSeriesZone(edited.end, master.end),
        start: inSeriesZone(edited.start, master.start),
      };
      // Left out keeps the series' pattern (its UNTIL in the form the new
      // start takes); an empty list ends it ("Repeat: None").
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        edited: event.recurrence,
        master,
        originalStart,
        start: event.start,
      });
      return yield* splitSeries({
        calendarId,
        destinationCalendarId: calendarId,
        master,
        // The new part keeps the series' zone (`event` is in it already).
        newSeries: sanitizeEventPayload({ ...master, ...event, recurrence }),
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

      const originalStartIso = originalStartOf(instance);

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
        const refusal =
          "Deleting this and following isn't available from an occurrence added to this series.";
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error(refusal), refusal })
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

      const originalStart = originalStartOf(instance);
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
      // its original slot, with the series' own fields and length (not
      // one occurrence's rescheduled time or edits), and the rest of a
      // COUNT; its rule lined up with that start.
      const slot = seriesSlotAt(master, originalStart);
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        edited: undefined,
        master,
        originalStart,
        start: slot.start,
      });
      const created = yield* splitSeries({
        calendarId,
        destinationCalendarId,
        master,
        newSeries: sanitizeEventPayload({
          ...master,
          end: slot.end,
          recurrence,
          start: slot.start,
        }),
        originalStart,
      });

      // The occurrence the user acted on keeps its own reschedule and
      // edits in the new series (best effort: the move itself is done).
      yield* keepOccurrenceInMovedSeries({
        calendarId: destinationCalendarId,
        instance,
        master,
        seriesId: created.id,
        slot,
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
