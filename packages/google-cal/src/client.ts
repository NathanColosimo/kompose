import { Context, Data, Effect, Layer, type ParseResult } from "effect";
import { google } from "googleapis";
import { z } from "zod";
import {
  type Calendar,
  CalendarSchema,
  type CreateCalendar,
  type CreateEvent,
  CreateEventInputSchema,
  type Event,
  EventSchema,
} from "./schema";

// -- Service Definition --

export type GoogleCalendarService = {
  // Calendar Operations
  readonly listCalendars: () => Effect.Effect<
    Calendar[],
    GoogleApiError | ParseResult.ParseError
  >;
  readonly getCalendar: (
    calendarId: string
  ) => Effect.Effect<Calendar, GoogleApiError | ParseResult.ParseError>;
  readonly createCalendar: (
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | ParseResult.ParseError>;
  readonly updateCalendar: (
    calendarId: string,
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | ParseResult.ParseError>;
  readonly deleteCalendar: (
    calendarId: string
  ) => Effect.Effect<void, GoogleApiError>;

  // Event Operations
  readonly listEvents: (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) => Effect.Effect<Event[], GoogleApiError | ParseResult.ParseError>;
  readonly getEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<Event, GoogleApiError | ParseResult.ParseError>;
  readonly createEvent: (
    calendarId: string,
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | ParseResult.ParseError>;
  readonly updateEvent: (
    calendarId: string,
    eventId: string,
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | ParseResult.ParseError>;
  readonly deleteEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<void, GoogleApiError>;
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

// -- Implementation --

const make = (accessToken: string): GoogleCalendarService => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const client = google.calendar({ version: "v3", auth });

  // --- Calendar Methods ---

  const listCalendars = () =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.calendarList.list(),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      if (!response.data.items) {
        return [];
      }

      return z.array(CalendarSchema).parse(response.data.items);
    });

  const getCalendar = (calendarId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.calendars.get({ calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return CalendarSchema.parse(response.data);
    });

  const createCalendar = (calendar: CreateCalendar) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.insert({
            requestBody: calendar,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return CalendarSchema.parse(response.data);
    });

  const updateCalendar = (calendarId: string, calendar: CreateCalendar) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.update({
            calendarId,
            requestBody: calendar,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return CalendarSchema.parse(response.data);
    });

  const deleteCalendar = (calendarId: string) =>
    Effect.tryPromise({
      try: () => client.calendars.delete({ calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

  // --- Event Methods ---

  const listEvents = (calendarId: string, timeMin: string, timeMax: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.events.list({
            calendarId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      if (!response.data.items) {
        return [];
      }

      return z.array(EventSchema).parse(response.data.items);
    });

  const getEvent = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.events.get({ calendarId, eventId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return EventSchema.parse(response.data);
    });

  const createEvent = (calendarId: string, event: CreateEvent) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.events.insert({
            calendarId,
            requestBody: CreateEventInputSchema.parse(event),
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return EventSchema.parse(response.data);
    });

  const updateEvent = (
    calendarId: string,
    eventId: string,
    event: CreateEvent
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.events.update({
            calendarId,
            eventId,
            requestBody: event,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return EventSchema.parse(response.data);
    });

  const deleteEvent = (calendarId: string, eventId: string) =>
    Effect.tryPromise({
      try: () => client.events.delete({ calendarId, eventId }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

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
  };
};

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, make(accessToken));
