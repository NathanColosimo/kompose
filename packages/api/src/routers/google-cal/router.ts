import { auth } from "@kompose/auth";
import {
  type GoogleApiError,
  GoogleCalendar,
  GoogleCalendarLive,
  type GoogleCalendarZodError,
} from "@kompose/google-cal/client";
import { implement, ORPCError } from "@orpc/server";
import { Effect, Layer, Option } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUserBestEffort } from "../../realtime/sync";
import { TelemetryLive } from "../../telemetry";
import {
  GoogleCalendarCacheService,
  logAndSwallowCacheError,
  logCacheErrorAndMiss,
} from "./cache";
import { googleCalContract } from "./contract";
import { AccountNotLinkedError } from "./errors";

/** Merged layer providing both cache service and telemetry. */
const GoogleCalLive = Layer.merge(
  GoogleCalendarCacheService.Default,
  TelemetryLive
);

export function handleError(
  error: AccountNotLinkedError | GoogleApiError | GoogleCalendarZodError,
  accountId: string,
  userId: string
): never {
  switch (error._tag) {
    case "AccountNotLinkedError":
      throw new ORPCError("ACCOUNT_NOT_LINKED", {
        message: JSON.stringify(error.cause),
        data: { accountId, userId },
      });
    case "GoogleApiError":
      throw new ORPCError("GOOGLE_API_ERROR", {
        message: JSON.stringify(error.cause),
        data: { accountId, userId },
      });
    case "GoogleCalendarZodError":
      throw new ORPCError("PARSE_ERROR", {
        message: error.message,
        data: { cause: error.cause },
      });
    default:
      throw new ORPCError("UNKNOWN_ERROR", {
        message: JSON.stringify(error),
        data: { accountId, userId },
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
      catch: (cause) =>
        new AccountNotLinkedError({
          message: "Google account not linked or token unavailable",
          cause,
        }),
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
    payload: { accountId, calendarId },
  });
}

function includesSearchText(value: string | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query) ?? false;
}

// ── Router ──────────────────────────────────────────────────────────

export const googleCalRouter = os.router({
  calendars: {
    list: os.calendars.list.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;

        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        // Check cache — log errors, fall through to API on failure
        const cached = yield* cache
          .getCachedCalendars(input.accountId)
          .pipe(logCacheErrorAndMiss);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        // Cache miss — fetch from Google API
        const calendars = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.listCalendars();
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Populate cache (best effort)
        yield* cache
          .setCachedCalendars(input.accountId, calendars)
          .pipe(logAndSwallowCacheError);

        return calendars;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
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
        const cache = yield* GoogleCalendarCacheService;

        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        // Check cache — log errors, fall through to API on failure
        const cached = yield* cache
          .getCachedCalendar(input.accountId, input.calendarId)
          .pipe(logCacheErrorAndMiss);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        // Cache miss — fetch from Google API
        const calendar = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.getCalendar(input.calendarId);
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Populate cache (best effort)
        yield* cache
          .setCachedCalendar(input.accountId, input.calendarId, calendar)
          .pipe(logAndSwallowCacheError);

        return calendar;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
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
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const calendar = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.createCalendar(input.calendar);
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Invalidate calendar list cache (best effort)
        yield* cache
          .invalidateCalendars(input.accountId)
          .pipe(logAndSwallowCacheError);

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          calendar.id
        );

        return calendar;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (calendar) => calendar,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    update: os.calendars.update.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const calendar = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.updateCalendar(
            input.calendarId,
            input.calendar
          );
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // invalidateCalendars covers both the list key and all single-calendar keys
        yield* cache
          .invalidateCalendars(input.accountId)
          .pipe(logAndSwallowCacheError);

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          input.calendarId
        );

        return calendar;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (calendar) => calendar,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    delete: os.calendars.delete.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.deleteCalendar(input.calendarId);
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Deleting whole calendar — invalidateCalendars covers list + all single-cal keys
        yield* Effect.all(
          [
            cache
              .invalidateCalendars(input.accountId)
              .pipe(logAndSwallowCacheError),
            cache
              .invalidateAllEvents(input.accountId, input.calendarId)
              .pipe(logAndSwallowCacheError),
          ],
          { concurrency: "unbounded", discard: true }
        );

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          input.calendarId
        );

        return null;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (result) => result,
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
        const cache = yield* GoogleCalendarCacheService;

        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const cached = yield* cache
          .getCachedColors(input.accountId)
          .pipe(logCacheErrorAndMiss);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        const colors = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.listColors();
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        yield* cache
          .setCachedColors(input.accountId, colors)
          .pipe(logAndSwallowCacheError);

        return colors;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
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
      const searchQuery = input.params.query?.toLowerCase();

      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;

        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const cached = yield* cache
          .getCachedEvents(
            input.accountId,
            input.calendarId,
            input.params.timeMin,
            input.params.timeMax
          )
          .pipe(logCacheErrorAndMiss);
        if (Option.isSome(cached)) {
          if (!searchQuery) {
            return cached.value;
          }
          return cached.value.filter(
            (event: {
              summary?: string;
              description?: string;
              location?: string;
            }) =>
              includesSearchText(event.summary, searchQuery) ||
              includesSearchText(event.description, searchQuery) ||
              includesSearchText(event.location, searchQuery)
          );
        }

        const events = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.listEvents(
            input.calendarId,
            input.params.timeMin,
            input.params.timeMax
          );
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        yield* cache
          .setCachedEvents(
            input.accountId,
            input.calendarId,
            input.params.timeMin,
            input.params.timeMax,
            events
          )
          .pipe(logAndSwallowCacheError);

        if (!searchQuery) {
          return events;
        }
        return events.filter(
          (event) =>
            includesSearchText(event.summary, searchQuery) ||
            includesSearchText(event.description, searchQuery) ||
            includesSearchText(event.location, searchQuery)
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
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
        const cache = yield* GoogleCalendarCacheService;

        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const cached = yield* cache
          .getCachedEvent(input.accountId, input.calendarId, input.eventId)
          .pipe(logCacheErrorAndMiss);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        const event = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.getEvent(input.calendarId, input.eventId);
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        yield* cache
          .setCachedEvent(
            input.accountId,
            input.calendarId,
            input.eventId,
            event
          )
          .pipe(logAndSwallowCacheError);

        return event;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
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
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const event = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.createEvent(input.calendarId, input.event);
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // New event — only list cache is stale
        yield* cache
          .invalidateEventLists(input.accountId, input.calendarId)
          .pipe(logAndSwallowCacheError);

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          input.calendarId
        );

        return event;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (event) => event,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    update: os.events.update.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const event = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.updateEvent(
            input.calendarId,
            input.eventId,
            input.event,
            input.scope
          );
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Invalidate event lists + the specific edited event concurrently
        yield* Effect.all(
          [
            cache
              .invalidateEventLists(input.accountId, input.calendarId)
              .pipe(logAndSwallowCacheError),
            cache
              .invalidateEvent(input.accountId, input.calendarId, input.eventId)
              .pipe(logAndSwallowCacheError),
          ],
          { concurrency: "unbounded", discard: true }
        );

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          input.calendarId
        );

        return event;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (event) => event,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    move: os.events.move.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        const event = yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.moveEvent(
            input.calendarId,
            input.eventId,
            input.destinationCalendarId,
            input.scope
          );
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        // Lists on both calendars + the moved event's source key
        yield* Effect.all(
          [
            cache
              .invalidateEventLists(input.accountId, input.calendarId)
              .pipe(logAndSwallowCacheError),
            cache
              .invalidateEventLists(
                input.accountId,
                input.destinationCalendarId
              )
              .pipe(logAndSwallowCacheError),
            cache
              .invalidateEvent(input.accountId, input.calendarId, input.eventId)
              .pipe(logAndSwallowCacheError),
          ],
          { concurrency: "unbounded", discard: true }
        );

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
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (event) => event,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),

    delete: os.events.delete.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const cache = yield* GoogleCalendarCacheService;
        const accessToken = yield* checkGoogleAccountIsLinked(
          context.user.id,
          input.accountId
        );

        yield* Effect.gen(function* () {
          const service = yield* GoogleCalendar;
          return yield* service.deleteEvent(
            input.calendarId,
            input.eventId,
            input.scope
          );
        }).pipe(Effect.provide(GoogleCalendarLive(accessToken)));

        yield* Effect.all(
          [
            cache
              .invalidateEventLists(input.accountId, input.calendarId)
              .pipe(logAndSwallowCacheError),
            cache
              .invalidateEvent(input.accountId, input.calendarId, input.eventId)
              .pipe(logAndSwallowCacheError),
          ],
          { concurrency: "unbounded", discard: true }
        );

        publishGoogleCalendarEvent(
          context.user.id,
          input.accountId,
          input.calendarId
        );

        return null;
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(GoogleCalLive),
          Effect.match({
            onSuccess: (result) => result,
            onFailure: (error) =>
              handleError(error, input.accountId, context.user.id),
          })
        )
      );
    }),
  },
});
