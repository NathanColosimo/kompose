import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import { getGoogleEventEditBlockReason } from "@kompose/google-cal/schema";
import { implement } from "@orpc/server";
import { Effect, Option } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { getLinkedAccessToken } from "../../lib/linked-account";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import { GoogleCalendarCacheService } from "./cache";
import { googleCalContract } from "./contract";
import { NonEditableGoogleEventError } from "./errors";

/** The Google Calendar client for one of the user's linked accounts. */
const getGoogleCalendar = Effect.fn("getGoogleCalendar")(function* (
  userId: string,
  accountId: string
) {
  const accessToken = yield* getLinkedAccessToken({
    accountId,
    providerId: "google",
    userId,
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
  });
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
      yield* cache.invalidateCalendars(context.user.id, input.accountId);

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
          cache.invalidateCalendars(context.user.id, input.accountId),
          cache.invalidateAllEvents(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
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

      // Check cache — log errors, fall through to API on failure
      const cached = yield* cache.getCachedCalendar(
        context.user.id,
        input.accountId,
        input.calendarId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      // Cache miss — fetch from Google API
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const calendar = yield* google.getCalendar(input.calendarId);

      // Populate cache (best effort)
      yield* cache.setCachedCalendar(
        context.user.id,
        input.accountId,
        input.calendarId,
        calendar
      );

      return calendar;
    }),
    list: os.calendars.list.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;

      // Check cache — log errors, fall through to API on failure
      const cached = yield* cache.getCachedCalendars(
        context.user.id,
        input.accountId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      // Cache miss — fetch from Google API
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const calendars = yield* google.listCalendars();

      // Populate cache (best effort)
      yield* cache.setCachedCalendars(
        context.user.id,
        input.accountId,
        calendars
      );

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
      yield* cache.invalidateCalendars(context.user.id, input.accountId);

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

      const cached = yield* cache.getCachedColors(
        context.user.id,
        input.accountId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const colors = yield* google.listColors();

      yield* cache.setCachedColors(context.user.id, input.accountId, colors);

      return colors;
    }),
  },

  events: {
    create: os.events.create.effect(function* ({ input, context }) {
      const cache = yield* GoogleCalendarCacheService;
      const google = yield* getGoogleCalendar(context.user.id, input.accountId);

      const event = yield* google.createEvent(input.calendarId, input.event);

      // New event — only list cache is stale
      yield* cache.invalidateEventLists(
        context.user.id,
        input.accountId,
        input.calendarId
      );

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
          cache.invalidateEventLists(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
          cache.invalidateEvent(
            context.user.id,
            input.accountId,
            input.calendarId,
            input.eventId
          ),
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

      const cached = yield* cache.getCachedEvent(
        context.user.id,
        input.accountId,
        input.calendarId,
        input.eventId
      );
      if (Option.isSome(cached)) {
        return cached.value;
      }

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const event = yield* google.getEvent(input.calendarId, input.eventId);

      yield* cache.setCachedEvent(
        context.user.id,
        input.accountId,
        input.calendarId,
        input.eventId,
        event
      );

      return event;
    }),
    list: os.events.list.effect(function* ({ input, context }) {
      const searchQuery = input.params.query?.toLowerCase();

      const cache = yield* GoogleCalendarCacheService;

      const cached = yield* cache.getCachedEvents(
        context.user.id,
        input.accountId,
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax
      );
      if (Option.isSome(cached)) {
        if (!searchQuery) {
          return cached.value;
        }
        return filterEventsBySearch(cached.value, searchQuery);
      }

      const google = yield* getGoogleCalendar(context.user.id, input.accountId);
      const events = yield* google.listEvents(
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax
      );

      yield* cache.setCachedEvents(
        context.user.id,
        input.accountId,
        input.calendarId,
        input.params.timeMin,
        input.params.timeMax,
        events
      );

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
          cache.invalidateEventLists(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
          cache.invalidateEventLists(
            context.user.id,
            input.accountId,
            input.destinationCalendarId
          ),
          cache.invalidateEvent(
            context.user.id,
            input.accountId,
            input.calendarId,
            input.eventId
          ),
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
          cache.invalidateEventLists(
            context.user.id,
            input.accountId,
            input.calendarId
          ),
          cache.invalidateEvent(
            context.user.id,
            input.accountId,
            input.calendarId,
            input.eventId
          ),
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
