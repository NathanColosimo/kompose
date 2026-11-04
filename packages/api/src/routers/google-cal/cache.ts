import {
  CalendarSchema,
  ColorsSchema,
  type Event,
  EventSchema,
} from "@kompose/google-cal/schema";
import { Context, Effect, Layer } from "effect";
import { makeRedisJsonCache } from "../../lib/redis-cache";

// ── Key prefixes & TTLs ─────────────────────────────────────────────

const KEY_PREFIX = "gcal";

/** TTLs are safety nets — webhooks handle real invalidation. */
const CALENDARS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const COLORS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const EVENTS_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// ── Key builders ────────────────────────────────────────────────────
//    Keys start with the user ID. An entry is written only after that user's
//    own token fetch for the account succeeded, so a cache hit needs no
//    ownership check.

function calendarsKey(userId: string, accountId: string): string {
  return `${KEY_PREFIX}:cals:${userId}:${accountId}`;
}

/** Key for a single cached calendar. */
function calendarKey(
  userId: string,
  accountId: string,
  calendarId: string
): string {
  return `${KEY_PREFIX}:cal:${userId}:${accountId}:${calendarId}`;
}

/** Prefix for scanning all single-calendar keys for a given account. */
function calendarSingleKeyPrefix(userId: string, accountId: string): string {
  return `${KEY_PREFIX}:cal:${userId}:${accountId}:`;
}

function colorsKey(userId: string, accountId: string): string {
  return `${KEY_PREFIX}:colors:${userId}:${accountId}`;
}

function eventsKey(
  userId: string,
  accountId: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): string {
  return `${KEY_PREFIX}:events:${userId}:${accountId}:${calendarId}:${timeMin}:${timeMax}`;
}

/** Prefix for scanning all event list keys for a given account + calendar. */
function eventsListKeyPrefix(
  userId: string,
  accountId: string,
  calendarId: string
): string {
  return `${KEY_PREFIX}:events:${userId}:${accountId}:${calendarId}:`;
}

/** Key for a single cached event (e.g. master recurring event). */
function eventSingleKey(
  userId: string,
  accountId: string,
  calendarId: string,
  eventId: string
): string {
  return `${KEY_PREFIX}:event:${userId}:${accountId}:${calendarId}:${eventId}`;
}

/** Prefix for scanning all single-event keys for a given account + calendar. */
function eventSingleKeyPrefix(
  userId: string,
  accountId: string,
  calendarId: string
): string {
  return `${KEY_PREFIX}:event:${userId}:${accountId}:${calendarId}:`;
}

// ── Service ─────────────────────────────────────────────────────────

export class GoogleCalendarCacheService extends Context.Service<GoogleCalendarCacheService>()(
  "GoogleCalendarCacheService",
  {
    make: Effect.sync(() => {
      const cache = makeRedisJsonCache("CACHE_ERROR");

      // ── Calendars ───────────────────────────────────────────────

      const getCachedCalendars = Effect.fn(
        "GoogleCalendarCacheService.getCachedCalendars"
      )(function* (userId: string, accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        return yield* cache.get(
          "getCachedCalendars",
          calendarsKey(userId, accountId),
          CalendarSchema.array()
        );
      });

      const setCachedCalendars = Effect.fn(
        "GoogleCalendarCacheService.setCachedCalendars"
      )(function* (userId: string, accountId: string, data: unknown) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* cache.set(
          "setCachedCalendars",
          calendarsKey(userId, accountId),
          data,
          CALENDARS_TTL_SECONDS
        );
      });

      /**
       * Invalidate the calendar list AND all single-calendar keys for an account.
       * Used by webhooks where we don't know which specific calendar changed.
       */
      const invalidateCalendars = Effect.fn(
        "GoogleCalendarCacheService.invalidateCalendars"
      )(function* (userId: string, accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* cache.remove("invalidateCalendars", {
          keys: [calendarsKey(userId, accountId)],
          prefixes: [calendarSingleKeyPrefix(userId, accountId)],
        });
      });

      // ── Single calendar ──────────────────────────────────────────

      const getCachedCalendar = Effect.fn(
        "GoogleCalendarCacheService.getCachedCalendar"
      )(function* (userId: string, accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        return yield* cache.get(
          "getCachedCalendar",
          calendarKey(userId, accountId, calendarId),
          CalendarSchema
        );
      });

      const setCachedCalendar = Effect.fn(
        "GoogleCalendarCacheService.setCachedCalendar"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        data: unknown
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* cache.set(
          "setCachedCalendar",
          calendarKey(userId, accountId, calendarId),
          data,
          CALENDARS_TTL_SECONDS
        );
      });

      // ── Colors ──────────────────────────────────────────────────

      const getCachedColors = Effect.fn(
        "GoogleCalendarCacheService.getCachedColors"
      )(function* (userId: string, accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        return yield* cache.get(
          "getCachedColors",
          colorsKey(userId, accountId),
          ColorsSchema
        );
      });

      const setCachedColors = Effect.fn(
        "GoogleCalendarCacheService.setCachedColors"
      )(function* (userId: string, accountId: string, data: unknown) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* cache.set(
          "setCachedColors",
          colorsKey(userId, accountId),
          data,
          COLORS_TTL_SECONDS
        );
      });

      // ── Events ──────────────────────────────────────────────────

      const getCachedEvents = Effect.fn(
        "GoogleCalendarCacheService.getCachedEvents"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        timeMin: string,
        timeMax: string
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        return yield* cache.get(
          "getCachedEvents",
          eventsKey(userId, accountId, calendarId, timeMin, timeMax),
          EventSchema.array()
        );
      });

      const setCachedEvents = Effect.fn(
        "GoogleCalendarCacheService.setCachedEvents"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        timeMin: string,
        timeMax: string,
        data: Event[]
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* cache.set(
          "setCachedEvents",
          eventsKey(userId, accountId, calendarId, timeMin, timeMax),
          data,
          EVENTS_TTL_SECONDS
        );
      });

      // ── Single event ────────────────────────────────────────────

      const getCachedEvent = Effect.fn(
        "GoogleCalendarCacheService.getCachedEvent"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        eventId: string
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        return yield* cache.get(
          "getCachedEvent",
          eventSingleKey(userId, accountId, calendarId, eventId),
          EventSchema
        );
      });

      const setCachedEvent = Effect.fn(
        "GoogleCalendarCacheService.setCachedEvent"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        eventId: string,
        data: unknown
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        yield* cache.set(
          "setCachedEvent",
          eventSingleKey(userId, accountId, calendarId, eventId),
          data,
          EVENTS_TTL_SECONDS
        );
      });

      // ── Invalidation ────────────────────────────────────────────

      /**
       * Invalidate ALL event-related cache for a calendar (list + single-event keys).
       * Used by webhooks where we don't know which specific event changed.
       */
      const invalidateAllEvents = Effect.fn(
        "GoogleCalendarCacheService.invalidateAllEvents"
      )(function* (userId: string, accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* cache.remove("invalidateAllEvents", {
          prefixes: [
            eventsListKeyPrefix(userId, accountId, calendarId),
            eventSingleKeyPrefix(userId, accountId, calendarId),
          ],
        });
      });

      /**
       * Invalidate only event list cache for a calendar.
       * Used by local mutations — the list has changed but unrelated single-event
       * keys (e.g. other master recurring events) can stay cached.
       */
      const invalidateEventLists = Effect.fn(
        "GoogleCalendarCacheService.invalidateEventLists"
      )(function* (userId: string, accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* cache.remove("invalidateEventLists", {
          prefixes: [eventsListKeyPrefix(userId, accountId, calendarId)],
        });
      });

      /** Invalidate a single cached event by its exact key. */
      const invalidateEvent = Effect.fn(
        "GoogleCalendarCacheService.invalidateEvent"
      )(function* (
        userId: string,
        accountId: string,
        calendarId: string,
        eventId: string
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        yield* cache.remove("invalidateEvent", {
          keys: [eventSingleKey(userId, accountId, calendarId, eventId)],
        });
      });

      return {
        getCachedCalendar,
        getCachedCalendars,
        getCachedColors,
        getCachedEvent,
        getCachedEvents,
        invalidateAllEvents,
        invalidateCalendars,
        invalidateEvent,
        invalidateEventLists,
        setCachedCalendar,
        setCachedCalendars,
        setCachedColors,
        setCachedEvent,
        setCachedEvents,
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
