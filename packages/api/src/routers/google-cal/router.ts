import { auth } from "@kompose/auth";
import {
  type GoogleApiError,
  GoogleCalendar,
  GoogleCalendarLive,
  type GoogleCalendarZodError,
} from "@kompose/google-cal/client";
import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUserBestEffort } from "../../realtime/sync";
import { TelemetryLive } from "../../telemetry";
import { googleCalContract } from "./contract";
import { AccountNotLinkedError } from "./errors";

export function handleError(
  error: AccountNotLinkedError | GoogleApiError | GoogleCalendarZodError,
  accountId: string,
  userId: string
): never {
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
    case "GoogleCalendarZodError":
      throw new ORPCError("PARSE_ERROR", {
        message: error.message,
        data: {
          cause: error.cause,
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

const checkGoogleAccountIsLinked = Effect.fn("checkGoogleAccountIsLinked")(
  function* (userId: string, accountId: string) {
    yield* Effect.annotateCurrentSpan("userId", userId);
    yield* Effect.annotateCurrentSpan("accountId", accountId);

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
  }
);

export const os = implement(googleCalContract)
  .use(requireAuth)
  .use(globalRateLimit);

function publishGoogleCalendarEvent(
  userId: string,
  accountId: string,
  calendarId: string
) {
  publishToUserBestEffort(userId, {
    type: "google-calendar",
    payload: {
      accountId,
      calendarId,
    },
  });
}

export const googleCalRouter = os.router({
  calendars: {
    list: os.calendars.list.handler(({ input, context }) => {
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (calendars) => calendars,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (calendar) => calendar,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (calendar) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                calendar.id
              );
              return calendar;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (calendar) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              return calendar;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (result) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              return result;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),
  },

  colors: {
    list: os.colors.list.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const colors = yield* service.listColors();
          return colors;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (colors) => colors,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (events) => events,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (event) => event,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (event) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              return event;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
            input.event,
            input.scope
          );
          return event;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (event) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              return event;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    move: os.events.move.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const serviceEffect = Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          const event = yield* service.moveEvent(
            input.calendarId,
            input.eventId,
            input.destinationCalendarId,
            input.scope
          );
          return event;
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (event) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.destinationCalendarId
              );
              return event;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
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
          return yield* service.deleteEvent(
            input.calendarId,
            input.eventId,
            input.scope
          );
        });

        return yield* serviceEffect.pipe(
          Effect.provide(GoogleCalendarLive(accessToken))
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(TelemetryLive),
          Effect.match({
            onSuccess: (result) => {
              publishGoogleCalendarEvent(
                context.user.id,
                input.accountId,
                input.calendarId
              );
              return result;
            },
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),
  },
});
