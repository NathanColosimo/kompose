import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import { Context, Effect, Layer, Schema } from "effect";
import { z } from "zod";
import {
  type Calendar,
  CalendarSchema,
  type Colors,
  ColorsSchema,
  type CreateCalendar,
  type CreateEvent,
  type Event,
  EventSchema,
  RecurrenceScope,
} from "./schema";
import {
  countOf,
  sanitizeEventPayload,
  truncateRecurrenceForFollowing,
  withRemainingCount,
} from "./recurrence-utils";
import { seriesTimesForEdit } from "./series-times";
import { matchRecurrenceToStart } from "./until";

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
 * The series' own rule, kept by an edit that didn't send one, with its
 * UNTIL in the form `start` takes: a series made all day (or timed) before
 * its rule loaded on the client would otherwise keep a mismatched UNTIL,
 * which Google refuses.
 */
function keptRecurrence(
  master: { recurrence?: string[]; start: { timeZone?: string } },
  start: { date?: string; dateTime?: string; timeZone?: string }
): string[] | undefined {
  return master.recurrence
    ? matchRecurrenceToStart(
        master.recurrence,
        start,
        start.timeZone ?? master.start.timeZone ?? "UTC"
      )
    : undefined;
}

/** `time` labelled with the series' zone when it has one (same moment). */
function inSeriesZone<T extends { date?: string; dateTime?: string; timeZone?: string }>(
  time: T,
  series: { timeZone?: string }
): T {
  return time.dateTime && series.timeZone ? { ...time, timeZone: series.timeZone } : time;
}

function getConferenceDataVersion(event: { conferenceData?: unknown }): number | undefined {
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

export type GoogleCalendarService = {
  // Calendar Operations
  readonly listCalendars: () => Effect.Effect<
    Calendar[],
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly getCalendar: (
    calendarId: string
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly createCalendar: (
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly updateCalendar: (
    calendarId: string,
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly deleteCalendar: (
    calendarId: string
  ) => Effect.Effect<void, GoogleApiError>;
  readonly listCalendarIds: () => Effect.Effect<
    string[],
    GoogleApiError | GoogleCalendarZodError
  >;

  // Event Operations
  readonly listEvents: (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) => Effect.Effect<Event[], GoogleApiError | GoogleCalendarZodError>;
  readonly getEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly createEvent: (
    calendarId: string,
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly updateEvent: (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope,
    currentEvent: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
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
  readonly getMasterRecurrence: (
    calendarId: string,
    event: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;

  readonly listColors: () => Effect.Effect<
    Colors,
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly watchCalendarList: (
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly watchCalendarEvents: (
    calendarId: string,
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly stopWatch: (params: {
    channelId: string;
    resourceId: string;
  }) => Effect.Effect<void, GoogleApiError>;
};

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
  },
) {
  /** What the API sends the client; `cause` stays on the server. */
  get publicError() {
    return {
      code: "BAD_GATEWAY",
      message: "Google Calendar request failed. Try again.",
    } as const;
  }
}

export class GoogleCalendarZodError extends Schema.TaggedError<GoogleCalendarZodError>()(
  "GoogleCalendarZodError",
  {
    cause: Schema.Unknown,
  },
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

  const listCalendarIds = Effect.fn("GoogleCalendar.listCalendarIds")(function* () {
    const calendars = yield* listCalendars();
    return Array.from(
      new Set(
        calendars
          .map((calendar) => calendar.id)
          .filter((id): id is string => Boolean(id))
      )
    );
  });

  const getCalendar = Effect.fn("GoogleCalendar.getCalendar")(function* (calendarId: string) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      const response = yield* Effect.tryPromise({
        try: () => client.users.me.calendarList.retrieve(calendarId),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = CalendarSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const createCalendar = Effect.fn("GoogleCalendar.createCalendar")(function* (calendar: CreateCalendar) {
      const response = yield* Effect.tryPromise({
        try: () => client.users.me.calendarList.create(calendar),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = CalendarSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const updateCalendar = Effect.fn("GoogleCalendar.updateCalendar")(function* (calendarId: string, calendar: CreateCalendar) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      const response = yield* Effect.tryPromise({
        try: () => client.users.me.calendarList.update(calendarId, calendar),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = CalendarSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const deleteCalendar = Effect.fn("GoogleCalendar.deleteCalendar")(function* (calendarId: string) {
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

  const watchCalendarList = Effect.fn("GoogleCalendar.watchCalendarList")(function* (channel: GoogleWatchChannelInput) {
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
    });

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
    });

  const stopWatch = Effect.fn("GoogleCalendar.stopWatch")(
    function* (params: { channelId: string; resourceId: string }) {
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
    },
  );

  // --- Event Methods ---

  const listEvents = Effect.fn("GoogleCalendar.listEvents")(
    function* (calendarId: string, timeMin: string, timeMax: string) {
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
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const getEvent = Effect.fn("GoogleCalendar.getEvent")(function* (calendarId: string, eventId: string) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventId", eventId);
      const response = yield* Effect.tryPromise({
        try: () => client.calendars.events.retrieve(eventId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const createEvent = Effect.fn("GoogleCalendar.createEvent")(function* (calendarId: string, event: CreateEvent) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventType", event.eventType ?? "default");
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
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const parseEventResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
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

      yield* Effect.annotateCurrentSpan("eventType", payload.eventType ?? "default");
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
   * How many of a series' occurrences came before the one that started at
   * `before` (cancelled ones too: COUNT counts them), for what's left of
   * its COUNT after a split.
   */
  const countOccurrencesBefore = (
    calendarId: string,
    masterId: string,
    before: string
  ) =>
    Effect.gen(function* () {
      const allDay = !before.includes("T");
      const cutoff = allDay ? null : Date.parse(before);
      // All of a COUNT series (it's finite), filtered by each one's
      // original start: one rescheduled past the split still counts.
      let count = 0;
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
          const isBefore = allDay
            ? (start?.date ?? "") < before
            : Date.parse(start?.dateTime ?? "") < (cutoff ?? 0);
          count += isBefore ? 1 : 0;
        }
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return count;
    });

  /**
   * The rule a series' following part repeats with: the edit's own, or the
   * series' kept rule; either way, a COUNT the user didn't change carries
   * on with what's left of it (a five-time series moved to another day at
   * its third runs three more, not five).
   */
  const followingRecurrence = (
    calendarId: string,
    master: Event,
    kept: string[] | undefined,
    edited: string[] | undefined,
    originalStart: string
  ) =>
    Effect.gen(function* () {
      const rule = edited ?? kept;
      const count = countOf(master.recurrence);
      if (!rule || count === undefined || countOf(rule) !== count) {
        return rule;
      }
      const used = yield* countOccurrencesBefore(
        calendarId,
        master.id,
        originalStart
      );
      return withRemainingCount(rule, used);
    });

  const updateEventAll = (
    calendarId: string,
    event: CreateEvent,
    currentEvent: Event,
    /**
     * The edit is to the series' own first date (the master itself, or its
     * first occurrence), so its date moves the series. Through any other
     * occurrence the series keeps its first date; a date move there is
     * "This and following" only.
     */
    editsFirstDate = !currentEvent.recurringEventId
  ) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, currentEvent);

      const times = editsFirstDate
        ? { end: event.end, start: event.start }
        : (seriesTimesForEdit({
            editedEnd: event.end,
            editedStart: event.start,
            masterEnd: master.end,
            masterStart: master.start,
            occurrenceEnd: currentEvent.end,
            occurrenceStart: currentEvent.start,
          }) ?? { end: master.end, start: master.start });

      // Left out keeps the series' pattern (its UNTIL in the form the
      // new start takes); an empty list ends it ("Repeat: None").
      const recurrence = event.recurrence ?? keptRecurrence(master, times.start);
      const payload = sanitizeEventPayload({
        ...master,
        ...event,
        start: times.start,
        end: times.end,
        recurrence,
      });
      yield* Effect.annotateCurrentSpan("eventType", payload.eventType ?? "default");
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
    event: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, currentEvent);
      if (!master.recurrence) {
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Event is not a recurring event") })
        );
      }

      const startIso =
        currentEvent.originalStartTime?.dateTime ?? currentEvent.originalStartTime?.date ??
        currentEvent.start.dateTime ?? currentEvent.start.date;
      const masterStartIso = master.start.dateTime ?? master.start.date;

      if (!startIso || !masterStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(startIso);
      const masterStart = new Date(masterStartIso);

      // First occurrence → "following" is the same as "all", from its
      // (possibly moved) date.
      if (occurrenceStart.getTime() <= masterStart.getTime()) {
        return yield* updateEventAll(calendarId, event, currentEvent, true);
      }

      const originalRecurrence = [...master.recurrence];
      // Left out keeps the series' pattern (its UNTIL in the form the
      // new start takes); an empty list ends it ("Repeat: None").
      // A kept COUNT carries on from where the series is cut.
      const recurrence = yield* followingRecurrence(
        calendarId,
        master,
        keptRecurrence(master, event.start),
        event.recurrence,
        startIso
      );

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        startIso
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

      // Google repeats a series in its start's zone: the new part keeps
      // the series' zone, whatever zone the edit was written in.
      const newSeriesPayload = sanitizeEventPayload({
        ...master,
        ...event,
        end: inSeriesZone(event.end, master.end),
        recurrence,
        start: inSeriesZone(event.start, master.start),
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
        Effect.catch(() => {
          return Effect.succeed(undefined);
        }),
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

  const updateEvent = Effect.fn("GoogleCalendar.updateEvent")(
    function* (
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
          return yield* updateEventAll(calendarId, event, currentEvent);
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

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        originalStartIso
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

  const deleteEvent = Effect.fn("GoogleCalendar.deleteEvent")(
    function* (calendarId: string, eventId: string, scope: RecurrenceScope) {
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
    function* (calendarId: string, eventId: string, destinationCalendarId: string) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventId", eventId);
      yield* Effect.annotateCurrentSpan("destinationCalendarId", destinationCalendarId);
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
    });

  const moveEvent = Effect.fn("GoogleCalendar.moveEvent")(
    function* (calendarId: string, eventId: string, destinationCalendarId: string, scope: RecurrenceScope) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventId", eventId);
      yield* Effect.annotateCurrentSpan("destinationCalendarId", destinationCalendarId);
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
        return yield* moveSingleEvent(calendarId, master.id, destinationCalendarId);
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

        // The new series carries on with what's left of a COUNT.
        const movedRecurrence = yield* followingRecurrence(
          calendarId,
          master,
          master.recurrence,
          undefined,
          originalStartIso
        );

        // 1) Cut off the original series up to the edited occurrence.
        const originalRecurrence = [...master.recurrence];
        const truncatedRecurrence = truncateRecurrenceForFollowing(
          master.recurrence,
          originalStartIso
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

        const truncatedMasterParsed = EventSchema.safeParse(truncatedMasterResponse);
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
          recurrence: movedRecurrence,
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
          Effect.catch(() => {
            return Effect.succeed(undefined);
          }),
          Effect.asVoid
        );

        const createResponse = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.create(destinationCalendarId, newSeriesPayload),
          catch: (cause) => {
            return new GoogleApiError({ cause });
          },
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

  const getMasterRecurrence = Effect.fn("GoogleCalendar.getMasterRecurrence")(function* (calendarId: string, event: Event) {
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
            new GoogleApiError({ cause: new Error("Event is not a recurring event") })
          );
        }
        return parsed.data;
      }

      const master = yield* Effect.tryPromise({
        try: () => {
          return client.calendars.events.retrieve(recurringEventId, { calendarId });
        },
        catch: (cause) => {
          return new GoogleApiError({ cause });
        },
      });

      const parsedMaster = EventSchema.safeParse(master);
      if (!parsedMaster.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsedMaster.error })
        );
      }

      return parsedMaster.data;
    });

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
};

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, makeGoogleCalendarService(accessToken));
