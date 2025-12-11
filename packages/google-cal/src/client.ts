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
  readonly moveEvent: (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly deleteEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<void, GoogleApiError>;
  readonly getMasterRecurrence: (
    calendarId: string,
    event: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;

  // Colors
  readonly listColors: () => Effect.Effect<
    Colors,
    GoogleApiError | GoogleCalendarZodError
  >;
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
  const logError = (label: string, cause: unknown) =>
    console.error(
      `[google-cal][error][${label}]`,
      typeof cause === "object" ? JSON.stringify(cause) : cause
    );

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
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(calendarId, {
            ...event,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(new GoogleCalendarZodError({ cause: parsed.error }));
      }

      return parsed.data;
    });

  const updateEvent = (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope
  ) =>
    Effect.gen(function* () {
      console.log("[google-cal][updateEvent] scope", scope, {
        calendarId,
        eventId,
        hasRecurrence: Boolean(event.recurrence?.length),
        recurrence: event.recurrence,
      });
      if (scope === "this") {
        const thisResponse = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.update(eventId, {
              ...event,
              calendarId,
            }),
          catch: (cause) => {
            logError("updateEvent:this:api", cause);
            return new GoogleApiError({ cause });
          },
        });

      const thisParsed = EventSchema.safeParse(thisResponse);
      if (!thisParsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: thisParsed.error })
        );
      }

      return thisParsed.data;
      } else if (scope === "all") {
          const allMaster = yield* getMasterRecurrence(calendarId, {
            ...event,
            id: eventId,
          });
        console.log("[google-cal][updateEvent][all] master", {
          masterId: allMaster.id,
          incomingRecurrence: event.recurrence,
          masterRecurrence: allMaster.recurrence,
        });
        // Preserve the master date, but apply edited times and duration.
        const { start: mergedStart, end: mergedEnd } = mergeStartEnd(
          allMaster.start,
          allMaster.end,
          event.start,
          event.end
        );
        const allPayloadStripped = stripRecurringLink(
          sanitizeEventPayload({
            ...allMaster,
            ...event,
            start: mergedStart,
            end: mergedEnd,
            recurrence: event.recurrence ?? allMaster.recurrence,
          })
        );
        console.log("[google-cal][updateEvent][all] payload", {
          masterId: allMaster.id,
          recurrence: allPayloadStripped.recurrence,
        });
        console.log("[google-cal][updateEvent][all] payload", allPayloadStripped);
          const allResponse = yield* Effect.tryPromise({
            try: () =>
              client.calendars.events.update(allMaster.id, {
              ...allPayloadStripped,
                calendarId,
              }),
          catch: (cause) => {
            logError("updateEvent:all:api", cause);
            return new GoogleApiError({ cause });
          },
          });

          const allParsed = EventSchema.safeParse(allResponse);
          if (!allParsed.success) {
          logError("updateEvent:all:parse", allParsed.error);
            return yield* Effect.fail(
              new GoogleCalendarZodError({ cause: allParsed.error })
            );
          }

          return allParsed.data;
        } else if (scope === "following") {
          const followingMaster = yield* getMasterRecurrence(calendarId, {
            ...event,
            id: eventId,
          });
          if (!followingMaster.recurrence) {
            return yield* Effect.fail(new GoogleApiError({ cause: new Error("Event is not a recurring event") }));
          }

          const originalStartIso =
            event.originalStartTime?.dateTime ?? event.originalStartTime?.date;
          const startIso = originalStartIso ?? event.start.dateTime ?? event.start.date;

          if (!startIso) {
            return yield* Effect.fail(new GoogleApiError({ cause: new Error("Event start is not a date or dateTime") }));
          }

          const occurrenceStart = new Date(startIso);

          // Cut off old master's recurrence to the edited occurrence
          const truncatedRecurrence = truncateRecurrenceForFollowing(
            followingMaster.recurrence,
            occurrenceStart,
            Boolean(followingMaster.start.date)
          );
        console.log("[google-cal][updateEvent][following] split", {
          masterId: followingMaster.id,
          originalRecurrence: followingMaster.recurrence,
          truncatedRecurrence,
          startIso,
        });

          const truncatedFollowingMasterResponse = yield* Effect.tryPromise({
            try: () =>
              client.calendars.events.update(followingMaster.id, {
                ...stripRecurringLink(
                  sanitizeEventPayload({
                    ...followingMaster,
                    recurrence: truncatedRecurrence,
                  })
                ),
                calendarId,
              }),
          catch: (cause) => {
            logError("updateEvent:following:update-master", cause);
            return new GoogleApiError({ cause });
          },
          });

          const truncatedFollowingMasterParsed = EventSchema.safeParse(truncatedFollowingMasterResponse);
          if (!truncatedFollowingMasterParsed.success) {
            logError(
              "updateEvent:following:parse-master",
              truncatedFollowingMasterParsed.error
            );
            return yield* Effect.fail(
              new GoogleCalendarZodError({ cause: truncatedFollowingMasterParsed.error })
            );
          }

          // Create new series starting at the edited occurrence
          const newSeriesPayloadStripped = stripRecurringLink(
            sanitizeEventPayload({
              ...followingMaster,
              ...event,
              recurrence: event.recurrence ?? followingMaster.recurrence,
            })
          );
        console.log("[google-cal][updateEvent][following] new series payload", {
          recurrence: newSeriesPayloadStripped.recurrence,
        });
          const createFollowingSeriesResponse = yield* Effect.tryPromise({
            try: () =>
              client.calendars.events.create(calendarId, {
              ...newSeriesPayloadStripped,
              }),
          catch: (cause) => {
            logError("updateEvent:following:create-series", cause);
            return new GoogleApiError({ cause });
          },
          });

          const createFollowingSeriesParsed = EventSchema.safeParse(createFollowingSeriesResponse);
          if (!createFollowingSeriesParsed.success) {
            logError(
              "updateEvent:following:parse-series",
              createFollowingSeriesParsed.error
            );
            return yield* Effect.fail(
              new GoogleCalendarZodError({ cause: createFollowingSeriesParsed.error })
            );
          }

          return createFollowingSeriesParsed.data;
      }

      return yield* Effect.fail(new GoogleApiError({ cause: new Error("Invalid recurrence scope") }));
    });

  const deleteEvent = (calendarId: string, eventId: string) =>
    Effect.tryPromise({
      try: () => client.calendars.events.delete(eventId, { calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

  const moveEvent = (
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
          console.log("[google-cal][getMasterRecurrence] fetch", {
            calendarId,
            recurringEventId,
          });
          return client.calendars.events.retrieve(recurringEventId, { calendarId });
        },
        catch: (cause) => {
          console.error("[google-cal][getMasterRecurrence] fetch error", cause);
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
    getMasterRecurrence,
  };
};

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, makeGoogleCalendarService(accessToken));
