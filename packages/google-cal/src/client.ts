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
} from "./schema";

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
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly deleteEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<void, GoogleApiError>;

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
    event: CreateEvent
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            ...event,
            calendarId,
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

  const deleteEvent = (calendarId: string, eventId: string) =>
    Effect.tryPromise({
      try: () => client.calendars.events.delete(eventId, { calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

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
    deleteEvent,
    listColors,
  };
};

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, makeGoogleCalendarService(accessToken));
