import { auth } from "@kompose/auth";
import { getLinkedAccountId } from "@kompose/auth/accounts";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import { getGoogleEventEditBlockReason } from "@kompose/google-cal/schema";
import { implement } from "@orpc/server";
import { Effect, Option } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import {
  GoogleCalendarCacheService,
  logAndSwallowCacheError,
  logCacheErrorAndMiss,
} from "./cache";
import { googleCalContract } from "./contract";
import { AccountNotLinkedError, NonEditableGoogleEventError } from "./errors";

/** The Google Calendar client for one of the user's linked accounts. */
const getGoogleCalendar = Effect.fn("getGoogleCalendar")(function* (
  userId: string,
  accountId: string
) {
  yield* Effect.annotateCurrentSpan("userId", userId);
  yield* Effect.annotateCurrentSpan("accountId", accountId);

  const { accessToken } = yield* Effect.tryPromise({
    catch: (cause) =>
      new AccountNotLinkedError({
        cause,
        message: "Google account not linked or token unavailable",
      }),
    try: async () => {
      const authAccountId = await getLinkedAccountId({
        providerAccountId: accountId,
        providerId: "google",
        userId,
      });
      return auth.api.getAccessToken({
        body: {
          accountId: authAccountId,
          userId,
        },
      });
    },
  });

  return makeGoogleCalendarService(accessToken);
});

export const os = implement(googleCalContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

function publishGoogleCalendarEvent(
  userId: string,
  accountId: string,
  calendarId: string
) {
  return publishToUser(userId, {
    payload: { accountId, calendarId },
    type: "google-calendar",
  }).pipe(Effect.catch(() => Effect.void));
}

function includesSearchText(value: string | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query) ?? false;
}

function filterEventsBySearch<
  T extends { summary?: string; description?: string; location?: string },
>(events: T[], query: string): T[] {
  return events.filter(
    (event) =>
      includesSearchText(event.summary, query) ||
      includesSearchText(event.description, query) ||
      includesSearchText(event.location, query)
  );
}

const ensureGoogleEventEditable = (event: {
  id: string;
  description?: string;
  eventType?: string;
  locked?: boolean;
}) => {
  const blockedReason = getGoogleEventEditBlockReason(event);
  if (!blockedReason) {
    return Effect.void;
  }

  return Effect.fail(
    new NonEditableGoogleEventError({
      eventId: event.id,
      eventType: event.eventType,
      message: blockedReason,
    })
  );
};

// ── Router ──────────────────────────────────────────────────────────

export const googleCalRouter = os.router({
  calendars: {
    create: os.calendars.create.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const calendar = yield* google.createCalendar(input.calendar);

      // Invalidate calendar list cache (best effort)
      yield* cache
        .invalidateCalendars(input.accountId)
        .pipe(logAndSwallowCacheError);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        calendar.id
      );

      return calendar;
    }),

    delete: os.calendars.delete.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      yield* google.deleteCalendar(input.calendarId);

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

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return null;
    }),

    get: os.calendars.get.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      // Check cache — log errors, fall through to API on failure
      const cached = yield* cache
        .getCachedCalendar(input.accountId, input.calendarId)
        .pipe(logCacheErrorAndMiss);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      // Cache miss — fetch from Google API
      const calendar = yield* google.getCalendar(input.calendarId);

      // Populate cache (best effort)
      yield* cache
        .setCachedCalendar(input.accountId, input.calendarId, calendar)
        .pipe(logAndSwallowCacheError);

      return calendar;
    }),
    list: os.calendars.list.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      // Check cache — log errors, fall through to API on failure
      const cached = yield* cache
        .getCachedCalendars(input.accountId)
        .pipe(logCacheErrorAndMiss);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      // Cache miss — fetch from Google API
      const calendars = yield* google.listCalendars();

      // Populate cache (best effort)
      yield* cache
        .setCachedCalendars(input.accountId, calendars)
        .pipe(logAndSwallowCacheError);

      return calendars;
    }),

    update: os.calendars.update.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const calendar = yield* google.updateCalendar(
        input.calendarId,
        input.calendar
      );

      // invalidateCalendars covers both the list key and all single-calendar keys
      yield* cache
        .invalidateCalendars(input.accountId)
        .pipe(logAndSwallowCacheError);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return calendar;
    }),
  },

  colors: {
    list: os.colors.list.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const cached = yield* cache
        .getCachedColors(input.accountId)
        .pipe(logCacheErrorAndMiss);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const colors = yield* google.listColors();

      yield* cache
        .setCachedColors(input.accountId, colors)
        .pipe(logAndSwallowCacheError);

      return colors;
    }),
  },

  events: {
    create: os.events.create.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const event = yield* google.createEvent(input.calendarId, input.event);

      // New event — only list cache is stale
      yield* cache
        .invalidateEventLists(input.accountId, input.calendarId)
        .pipe(logAndSwallowCacheError);

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return event;
    }),

    delete: os.events.delete.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      yield* google.deleteEvent(input.calendarId, input.eventId, input.scope);

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

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return null;
    }),

    get: os.events.get.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const cached = yield* cache
        .getCachedEvent(input.accountId, input.calendarId, input.eventId)
        .pipe(logCacheErrorAndMiss);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const event = yield* google.getEvent(input.calendarId, input.eventId);

      yield* cache
        .setCachedEvent(input.accountId, input.calendarId, input.eventId, event)
        .pipe(logAndSwallowCacheError);

      return event;
    }),
    list: os.events.list.effect(function* ({ input, context }) {
      const searchQuery = input.params.query?.toLowerCase();

      const cache = yield* GoogleCalendarCacheService;

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

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
        return filterEventsBySearch(cached.value, searchQuery);
      }

      const events = yield* google.listEvents(
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax
      );

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
      return filterEventsBySearch(events, searchQuery);
    }),

    move: os.events.move.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google.moveEvent(
        input.calendarId,
        input.eventId,
        input.destinationCalendarId,
        input.scope
      );

      // Lists on both calendars + the moved event's source key
      yield* Effect.all(
        [
          cache
            .invalidateEventLists(input.accountId, input.calendarId)
            .pipe(logAndSwallowCacheError),
          cache
            .invalidateEventLists(input.accountId, input.destinationCalendarId)
            .pipe(logAndSwallowCacheError),
          cache
            .invalidateEvent(input.accountId, input.calendarId, input.eventId)
            .pipe(logAndSwallowCacheError),
        ],
        { concurrency: "unbounded", discard: true }
      );

      yield* Effect.all(
        [
          publishGoogleCalendarEvent(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
          publishGoogleCalendarEvent(
            context.user.id,
            input.accountId,
            input.destinationCalendarId
          ),
        ],
        { concurrency: "unbounded", discard: true }
      );

      return event;
    }),

    update: os.events.update.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const currentEvent = yield* google.getEvent(
        input.calendarId,
        input.eventId
      );
      yield* ensureGoogleEventEditable(currentEvent);

      const event = yield* google.updateEvent(
        input.calendarId,
        input.eventId,
        input.event,
        input.scope,
        currentEvent
      );

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

      yield* publishGoogleCalendarEvent(
        context.user.id,
        input.accountId,
        input.calendarId
      );

      return event;
    }),
  },
});
