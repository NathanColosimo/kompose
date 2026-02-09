import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import { Context, Data, Effect, Layer } from "effect";
import { z, ZodError } from "zod";
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
  sanitizeEventPayload,
  stripRecurringLink,
  truncateRecurrenceForFollowing,
} from "./recurrence-utils";

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

function pickTimeZone(
  edited?: { timeZone?: string },
  master?: { timeZone?: string }
): string | undefined {
  return edited?.timeZone ?? master?.timeZone;
}

function extractDatePart(dateTime: string): string | null {
  const idx = dateTime.indexOf("T");
  return idx > 0 ? dateTime.slice(0, idx) : null;
}

function combineDateAndTime(
  master: { dateTime?: string; date?: string; timeZone?: string },
  edited: { dateTime?: string; date?: string; timeZone?: string }
): { dateTime?: string; date?: string; timeZone?: string } {
  // All-day: keep the master date
  if (master.date) {
    return { date: master.date };
  }
  // If either is missing, fall back to edited or master as-is
  if (!master.dateTime || !edited.dateTime) {
    return {
      dateTime: edited.dateTime ?? master.dateTime,
      date: edited.date ?? master.date,
      timeZone: pickTimeZone(edited, master),
    };
  }

  const masterDatePart = extractDatePart(master.dateTime);
  if (!masterDatePart) {
    return {
      dateTime: edited.dateTime,
      timeZone: pickTimeZone(edited, master),
    };
  }
  const timePartWithOffset = edited.dateTime.slice(11); // includes offset
  return {
    dateTime: `${masterDatePart}T${timePartWithOffset}`,
    timeZone: pickTimeZone(edited, master),
  };
}

function computeDurationMs(
  start?: { dateTime?: string },
  end?: { dateTime?: string }
): number | null {
  if (start?.dateTime && end?.dateTime) {
    const s = Date.parse(start.dateTime);
    const e = Date.parse(end.dateTime);
    if (!Number.isNaN(s) && !Number.isNaN(e)) {
      return e - s;
    }
  }
  return null;
}

function mergeStartEnd(
  masterStart: { dateTime?: string; date?: string; timeZone?: string },
  masterEnd: { dateTime?: string; date?: string; timeZone?: string },
  editedStart: { dateTime?: string; date?: string; timeZone?: string },
  editedEnd: { dateTime?: string; date?: string; timeZone?: string }
): {
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
} {
  // All-day: keep master dates
  if (masterStart.date || masterEnd.date) {
    return {
      start: { date: masterStart.date },
      end: { date: masterEnd.date },
    };
  }

  const mergedStart = combineDateAndTime(masterStart, editedStart);
  const durationMs =
    computeDurationMs(editedStart, editedEnd) ??
    computeDurationMs(masterStart, masterEnd);

  if (durationMs !== null && mergedStart.dateTime) {
    const startDate = new Date(mergedStart.dateTime);
    const endDate = new Date(startDate.getTime() + durationMs);
    return {
      start: mergedStart,
      end: {
        dateTime: endDate.toISOString(),
        timeZone: mergedStart.timeZone ?? pickTimeZone(editedEnd, masterEnd),
      },
    };
  }

  return {
    start: mergedStart,
    end: combineDateAndTime(masterEnd, editedEnd),
  };
}

function getConferenceDataVersion(event: { conferenceData?: unknown }): number | undefined {
  return event.conferenceData ? 1 : undefined;
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
    scope: RecurrenceScope
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
   * If `scope !== "this"` and the event is not recurring, this returns an error.
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

  // Colors
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

export class GoogleCalendar extends Context.Tag("GoogleCalendar")<
  GoogleCalendar,
  GoogleCalendarService
>() {}

// -- Errors --

export class GoogleApiError extends Data.TaggedError("GoogleApiError")<{
  cause: unknown;
  message?: string;
}> {}

export class GoogleCalendarZodError extends Data.TaggedError("GoogleCalendarZodError")<{
  cause: ZodError;
}> {}

// -- Implementation --

function makeGoogleCalendarService(accessToken: string): GoogleCalendarService {
  const client = new GoogleCalendarClient({ accessToken });

  // --- Calendar Methods ---

  const listCalendars = () =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.users.me.calendarList.list(),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      if (!response.items) {
        return [];
      }

      return z.array(CalendarSchema).parse(response.items);
    });

  const listCalendarIds = () =>
    listCalendars().pipe(
      Effect.map((calendars) =>
        Array.from(
          new Set(
            calendars
              .map((calendar) => calendar.id)
              .filter((id): id is string => Boolean(id))
          )
        )
      )
    );

  const getCalendar = (calendarId: string) =>
    Effect.gen(function* () {
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

  const createCalendar = (calendar: CreateCalendar) =>
    Effect.gen(function* () {
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

  const updateCalendar = (calendarId: string, calendar: CreateCalendar) =>
    Effect.gen(function* () {
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

  const deleteCalendar = (calendarId: string) =>
    Effect.tryPromise({
      try: () => client.users.me.calendarList.delete(calendarId),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

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

  const watchCalendarList = (channel: GoogleWatchChannelInput) =>
    Effect.gen(function* () {
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

  const watchCalendarEvents = (
    calendarId: string,
    channel: GoogleWatchChannelInput
  ) =>
    Effect.gen(function* () {
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

  const stopWatch = (params: { channelId: string; resourceId: string }) =>
    Effect.tryPromise({
      try: () =>
        client.stopWatching.stopWatching({
          id: params.channelId,
          resourceId: params.resourceId,
        }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

  // --- Event Methods ---

  const listEvents = (calendarId: string, timeMin: string, timeMax: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.list(calendarId, {
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      if (!response.items) {
        return [];
      }

      const parsed = z.array(EventSchema).safeParse(response.items);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const getEvent = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
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

  const createEvent = (calendarId: string, event: CreateEvent) =>
    Effect.gen(function* () {
      const conferenceDataVersion = getConferenceDataVersion(event);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(calendarId, {
            ...event,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  /**
   * Parse an event response and standardize Zod errors.
   */
  const parseEventResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }
      return parsed.data;
    });

  const updateEventThis = (calendarId: string, eventId: string, event: CreateEvent) =>
    Effect.gen(function* () {
      const conferenceDataVersion = getConferenceDataVersion(event);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            ...event,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
          }),
        catch: (cause) => {
          return new GoogleApiError({ cause });
        },
      });

      return yield* parseEventResponse(response);
    });

  const updateEventAll = (calendarId: string, eventId: string, event: CreateEvent) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, {
        ...event,
        id: eventId,
      });

      // Preserve the master date, but apply edited times and duration.
      const { start: mergedStart, end: mergedEnd } = mergeStartEnd(
        master.start,
        master.end,
        event.start,
        event.end
      );

      const payload = stripRecurringLink(
        sanitizeEventPayload({
          ...master,
          ...event,
          start: mergedStart,
          end: mergedEnd,
          recurrence: event.recurrence ?? master.recurrence,
        })
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
          return new GoogleApiError({ cause });
        },
      });

      return yield* parseEventResponse(response);
    });

  const updateEventFollowing = (
    calendarId: string,
    eventId: string,
    event: CreateEvent
  ) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, {
        ...event,
        id: eventId,
      });
      if (!master.recurrence) {
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Event is not a recurring event") })
        );
      }
      // Keep a copy so we can recover if the series create fails after truncation.
      const originalRecurrence = [...master.recurrence];

      const originalStartIso =
        event.originalStartTime?.dateTime ?? event.originalStartTime?.date;
      const startIso =
        originalStartIso ?? event.start.dateTime ?? event.start.date;

      if (!startIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(startIso);

      // Cut off old master's recurrence to the edited occurrence.
      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      const truncatedPayload = stripRecurringLink(
        sanitizeEventPayload({
          ...master,
          recurrence: truncatedRecurrence,
        })
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
          return new GoogleApiError({ cause });
        },
      });

      // Validate the truncate update (even though we return the new series).
      yield* parseEventResponse(truncateMasterResponse);

      // Create new series starting at the edited occurrence.
      const newSeriesPayload = stripRecurringLink(
        sanitizeEventPayload({
          ...master,
          ...event,
          recurrence: event.recurrence ?? master.recurrence,
        })
      );
      const newSeriesConferenceDataVersion =
        getConferenceDataVersion(newSeriesPayload);

      const restorePayload = stripRecurringLink(
        sanitizeEventPayload({
          ...master,
          recurrence: originalRecurrence,
        })
      );
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
        Effect.catchAll(() => {
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
          return new GoogleApiError({ cause });
        },
      }).pipe(
        Effect.catchAll((createError) =>
          // Restores master recurrence on error while returning the original error.
          restoreMasterRecurrence.pipe(Effect.zipRight(Effect.fail(createError)))
        )
      );

      return yield* parseEventResponse(createResponse);
    });

  const updateEvent = (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope
  ) =>
    Effect.gen(function* () {
      switch (scope) {
        case "this":
          return yield* updateEventThis(calendarId, eventId, event);
        case "all":
          return yield* updateEventAll(calendarId, eventId, event);
        case "following":
          return yield* updateEventFollowing(calendarId, eventId, event);
        default:
          return yield* Effect.fail(
            new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
          );
      }
    });

  /**
   * Delete a single instance by cancelling it (setting status to "cancelled").
   * This creates an exception within the series without affecting other occurrences.
   */
  const deleteEventThis = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      // Get the instance first to ensure it exists and preserve its structure
      const instance = yield* getEvent(calendarId, eventId);

      // Update the instance to set status to "cancelled"
      // The API requires preserving essential fields for recurring event exceptions
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

  /**
   * Delete the entire series by deleting the master event.
   */
  const deleteEventAll = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      // Get the instance to resolve the master if needed
      const instance = yield* getEvent(calendarId, eventId);

      // Determine if this is already the master or an instance
      const isRecurring = Boolean(
        instance.recurringEventId || instance.recurrence?.length
      );

      let masterId = eventId;
      if (instance.recurringEventId) {
        // This is an instance, get the master
        const master = yield* getMasterRecurrence(calendarId, instance);
        masterId = master.id;
      } else if (!isRecurring) {
        // Not a recurring event, just delete it directly
        return yield* Effect.tryPromise({
          try: () => client.calendars.events.delete(eventId, { calendarId }),
          catch: (cause) => new GoogleApiError({ cause }),
        }).pipe(Effect.asVoid);
      }

      // Delete the master event
      return yield* Effect.tryPromise({
        try: () => client.calendars.events.delete(masterId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(Effect.asVoid);
    });

  /**
   * Delete all following instances by truncating the recurrence rule at the occurrence date.
   */
  const deleteEventFollowing = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      // Get the instance to resolve the master and occurrence start
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

      // Get the occurrence start time
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

      // Truncate the recurrence rule at the occurrence date
      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      // Update the master event with the truncated recurrence
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...stripRecurringLink(
              sanitizeEventPayload({
                ...master,
                recurrence: truncatedRecurrence,
              })
            ),
            calendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
    }).pipe(Effect.asVoid);

  /**
   * Delete an event with scope handling for recurring events.
   */
  const deleteEvent = (
    calendarId: string,
    eventId: string,
    scope: RecurrenceScope
  ) =>
    Effect.gen(function* () {
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

  const moveSingleEvent = (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string
  ) =>
    Effect.gen(function* () {
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

  const moveEvent = (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string,
    scope: RecurrenceScope
  ) =>
    Effect.gen(function* () {
      if (scope === "this") {
        return yield* moveSingleEvent(calendarId, eventId, destinationCalendarId);
      }

      // Fetch the instance so we can resolve the series master and occurrence start.
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
              ...stripRecurringLink(
                sanitizeEventPayload({
                  ...master,
                  recurrence: truncatedRecurrence,
                })
              ),
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
        const newSeriesPayload = stripRecurringLink(
          sanitizeEventPayload({
            ...master,
            ...instance,
            start: instance.start,
            end: instance.end,
            recurrence: master.recurrence,
          })
        );

        const restoreMasterRecurrence = Effect.tryPromise({
          try: () =>
            client.calendars.events.update(master.id, {
              ...stripRecurringLink(
                sanitizeEventPayload({
                  ...master,
                  recurrence: originalRecurrence,
                })
              ),
              calendarId,
            }),
          catch: (restoreCause) => new GoogleApiError({ cause: restoreCause }),
        }).pipe(
          Effect.catchAll(() => {
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
          Effect.catchAll((createError) =>
            // Restores master recurrence on error while returning the original error.
            restoreMasterRecurrence.pipe(Effect.zipRight(Effect.fail(createError)))
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

  const listColors = () =>
    Effect.gen(function* () {
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

  const getMasterRecurrence = (calendarId: string, event: Event) =>
    Effect.gen(function* () {
      const parsed = EventSchema.safeParse(event);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      const recurringEventId = parsed.data.recurringEventId;
      if (!recurringEventId) {
        // Is single event with no recurrence
        if (!parsed.data.recurrence) {
          return yield* Effect.fail(
            new GoogleApiError({ cause: new Error("Event is not a recurring event") })
          );
        }
        // Is master event already
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
