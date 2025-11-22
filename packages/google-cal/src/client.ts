import { Context, Data, Effect, Layer, type ParseResult, Schema } from "effect";
import { type calendar_v3, google } from "googleapis";
import {
  Calendar,
  type CreateCalendarInput,
  type CreateEventInput,
  Event,
} from "./schema";

// -- Service Definition --

export type GoogleCalendarService = {
  // Calendar Operations
  readonly listCalendars: () => Effect.Effect<
    readonly (typeof Calendar.Type)[],
    GoogleApiError | ParseResult.ParseError
  >;
  readonly getCalendar: (
    calendarId: string
  ) => Effect.Effect<
    typeof Calendar.Type,
    GoogleApiError | ParseResult.ParseError
  >;
  readonly createCalendar: (
    calendar: typeof CreateCalendarInput.Encoded
  ) => Effect.Effect<
    typeof Calendar.Type,
    GoogleApiError | ParseResult.ParseError
  >;
  readonly updateCalendar: (
    calendarId: string,
    calendar: typeof CreateCalendarInput.Encoded
  ) => Effect.Effect<
    typeof Calendar.Type,
    GoogleApiError | ParseResult.ParseError
  >;
  readonly deleteCalendar: (
    calendarId: string
  ) => Effect.Effect<void, GoogleApiError>;

  // Event Operations
  readonly listEvents: (
    calendarId: string
  ) => Effect.Effect<
    readonly (typeof Event.Type)[],
    GoogleApiError | ParseResult.ParseError
  >;
  readonly getEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<
    typeof Event.Type,
    GoogleApiError | ParseResult.ParseError
  >;
  readonly createEvent: (
    calendarId: string,
    event: typeof CreateEventInput.Encoded
  ) => Effect.Effect<
    typeof Event.Type,
    GoogleApiError | ParseResult.ParseError
  >;
  readonly updateEvent: (
    calendarId: string,
    eventId: string,
    event: typeof CreateEventInput.Encoded
  ) => Effect.Effect<
    typeof Event.Type,
    GoogleApiError | ParseResult.ParseError
  >;
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

      return yield* Schema.decodeUnknown(Schema.Array(Calendar))(
        response.data.items
      );
    });

  const getCalendar = (calendarId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.calendars.get({ calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Calendar)(response.data);
    });

  const createCalendar = (calendar: typeof CreateCalendarInput.Encoded) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.insert({
            requestBody: calendar,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Calendar)(response.data);
    });

  const updateCalendar = (
    calendarId: string,
    calendar: typeof CreateCalendarInput.Encoded
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.update({
            calendarId,
            requestBody: calendar,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Calendar)(response.data);
    });

  const deleteCalendar = (calendarId: string) =>
    Effect.tryPromise({
      try: () => client.calendars.delete({ calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    }).pipe(Effect.asVoid);

  // --- Event Methods ---

  const listEvents = (calendarId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.events.list({ calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      if (!response.data.items) {
        return [];
      }

      return yield* Schema.decodeUnknown(Schema.Array(Event))(
        response.data.items
      );
    });

  const getEvent = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => client.events.get({ calendarId, eventId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Event)(response.data);
    });

  const createEvent = (
    calendarId: string,
    event: typeof CreateEventInput.Encoded
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.events.insert({
            calendarId,
            requestBody: event as calendar_v3.Schema$Event,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Event)(response.data);
    });

  const updateEvent = (
    calendarId: string,
    eventId: string,
    event: typeof CreateEventInput.Encoded
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.events.update({
            calendarId,
            eventId,
            requestBody: event as calendar_v3.Schema$Event,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* Schema.decodeUnknown(Event)(response.data);
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
