import { auth } from "@kompose/auth";
import {
  type GoogleApiError,
  GoogleCalendar,
  GoogleCalendarLive,
} from "@kompose/google-cal/client";
import { implement, ORPCError } from "@orpc/server";
import { Console, Data, Effect, type ParseResult } from "effect";
import { requireAuth } from "../..";
import { googleCalContract } from "./contract";

export class AccountNotLinkedError extends Data.TaggedError(
  "AccountNotLinkedError"
)<{
  cause: unknown;
}> {}

export function handleError(
  error: AccountNotLinkedError | GoogleApiError | ParseResult.ParseError,
  accountId: string,
  userId: string
): never {
  // // Log error details for debugging
  // console.error("Google Calendar Router Error:", {
  //   errorType: error._tag,
  //   message: (error as any).message || "Unknown error",
  //   cause: (error as any).cause,
  //   accountId,
  //   userId,
  // });

  switch (error._tag) {
    case "AccountNotLinkedError":
      throw new ORPCError("ACCOUNT_NOT_LINKED", {
        message: JSON.stringify(error.cause),
        data: {
          accountId,
          userId,
        },
      });
    case "GoogleApiError":
      throw new ORPCError("GOOGLE_API_ERROR", {
        message: JSON.stringify(error.cause),
        data: {
          accountId,
          userId,
        },
      });
    case "ParseError":
      throw new ORPCError("PARSE_ERROR", {
        message: JSON.stringify(error.cause),
        data: {
          accountId,
          userId,
        },
      });
    default:
      throw new ORPCError("UNKNOWN_ERROR", {
        message: JSON.stringify(error),
        data: {
          accountId,
          userId,
        },
      });
  }
}

const checkGoogleAccountIsLinked = (userId: string, accountId: string) =>
  Effect.gen(function* () {
    const accessToken = yield* Effect.tryPromise({
      try: () =>
        auth.api.getAccessToken({
          body: {
            accountId,
            userId,
            providerId: "google",
          },
        }),
      catch: (cause) => new AccountNotLinkedError({ cause }),
    });

    return accessToken.accessToken;
  });

export const os = implement(googleCalContract).use(requireAuth);

export const googleCalRouter = os.router({
  calendars: {
    list: os.calendars.list.handler(({ input, context }) => {
      Console.log("listCalendars input:", input);
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const calendars = yield* service.listCalendars();
          return calendars;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (calendars) => calendars,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    get: os.calendars.get.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const calendar = yield* service.getCalendar(input.calendarId);
          return calendar;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (calendar) => calendar,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    create: os.calendars.create.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const calendar = yield* service.createCalendar(input.calendar);
          return calendar;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (calendar) => calendar,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    update: os.calendars.update.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const calendar = yield* service.updateCalendar(
            input.calendarId,
            input.calendar
          );
          return calendar;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (calendar) => calendar,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    delete: os.calendars.delete.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.deleteCalendar(input.calendarId);
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (result) => result,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),
  },

  events: {
    list: os.events.list.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const events = yield* service.listEvents(
            input.calendarId,
            input.timeMin,
            input.timeMax
          );
          return events;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (events) => events,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    get: os.events.get.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const event = yield* service.getEvent(
            input.calendarId,
            input.eventId
          );
          return event;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (event) => event,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    create: os.events.create.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const event = yield* service.createEvent(
            input.calendarId,
            input.event
          );
          return event;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (event) => event,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    update: os.events.update.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const event = yield* service.updateEvent(
            input.calendarId,
            input.eventId,
            input.event
          );
          return event;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (event) => event,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),

    delete: os.events.delete.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.deleteEvent(input.calendarId, input.eventId);
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        Effect.match(program, {
          onSuccess: (result) => result,
          onFailure: (error) =>
            handleError(error, input.accountId, context.user.id),
        })
      );
    }),
  },
});
