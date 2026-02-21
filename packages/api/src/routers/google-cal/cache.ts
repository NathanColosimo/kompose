import { env } from "@kompose/env";
import {
  CalendarSchema,
  ColorsSchema,
  type Event,
  EventSchema,
} from "@kompose/google-cal/schema";
import { RedisClient } from "bun";
import { Effect, Option } from "effect";
import { CacheError } from "./errors";

// ── Shared error handlers ────────────────────────────────────────────

/** Log a CacheError at error level (visible in OTel) then swallow it. */
export const logAndSwallowCacheError = <A, R>(
  self: Effect.Effect<A, CacheError, R>
) =>
  self.pipe(
    Effect.catchTag("CacheError", (err) => Effect.logError("CACHE_ERROR", err))
  );

/** Same as above but recovers with Option.none() for cache reads. */
export const logCacheErrorAndMiss = <A, R>(
  self: Effect.Effect<A, CacheError, R>
) =>
  self.pipe(
    Effect.catchTag("CacheError", (err) =>
      Effect.logError("CACHE_ERROR", err).pipe(Effect.map(() => Option.none()))
    )
  );

// ── Key prefixes & TTLs ─────────────────────────────────────────────

const KEY_PREFIX = "gcal";

/** TTLs are safety nets — webhooks handle real invalidation. */
const CALENDARS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const COLORS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const EVENTS_TTL_SECONDS = 60 * 60; // 1 hour

// ── Key builders ────────────────────────────────────────────────────

function calendarsKey(accountId: string): string {
  return `${KEY_PREFIX}:cals:${accountId}`;
}

/** Key for a single cached calendar. */
function calendarKey(accountId: string, calendarId: string): string {
  return `${KEY_PREFIX}:cal:${accountId}:${calendarId}`;
}

/** Prefix for scanning all single-calendar keys for a given account. */
function calendarSingleKeyPrefix(accountId: string): string {
  return `${KEY_PREFIX}:cal:${accountId}:`;
}

function colorsKey(accountId: string): string {
  return `${KEY_PREFIX}:colors:${accountId}`;
}

function eventsKey(
  accountId: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): string {
  return `${KEY_PREFIX}:events:${accountId}:${calendarId}:${timeMin}:${timeMax}`;
}

/** Prefix for scanning all event list keys for a given account + calendar. */
function eventsListKeyPrefix(accountId: string, calendarId: string): string {
  return `${KEY_PREFIX}:events:${accountId}:${calendarId}:`;
}

/** Key for a single cached event (e.g. master recurring event). */
function eventSingleKey(
  accountId: string,
  calendarId: string,
  eventId: string
): string {
  return `${KEY_PREFIX}:event:${accountId}:${calendarId}:${eventId}`;
}

/** Prefix for scanning all single-event keys for a given account + calendar. */
function eventSingleKeyPrefix(accountId: string, calendarId: string): string {
  return `${KEY_PREFIX}:event:${accountId}:${calendarId}:`;
}

// ── Redis client ────────────────────────────────────────────────────

/** Dedicated Redis client for Google Calendar caching. */
const redis = new RedisClient(env.REDIS_URL);

// ── Service ─────────────────────────────────────────────────────────

export class GoogleCalendarCacheService extends Effect.Service<GoogleCalendarCacheService>()(
  "GoogleCalendarCacheService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      /** SCAN + DEL all keys matching a prefix. Avoids KEYS to not block Redis. */
      const scanAndDelete = async (prefix: string) => {
        let cursor = 0;
        do {
          const result = (await redis.send("SCAN", [
            cursor.toString(),
            "MATCH",
            `${prefix}*`,
            "COUNT",
            "100",
          ])) as [string, string[]];
          cursor = Number(result[0]);
          const keys = result[1];
          if (keys.length > 0) {
            await redis.send("DEL", keys);
          }
        } while (cursor !== 0);
      };

      // ── Calendars ───────────────────────────────────────────────

      const getCachedCalendars = Effect.fn(
        "GoogleCalendarCacheService.getCachedCalendars"
      )(function* (accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        const raw = yield* Effect.tryPromise({
          try: () => redis.get(calendarsKey(accountId)),
          catch: (cause) =>
            new CacheError({
              operation: "getCachedCalendars",
              message: String(cause),
            }),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new CacheError({
              operation: "getCachedCalendars",
              message: `Invalid cached JSON: ${String(cause)}`,
            }),
        });

        const parsed = CalendarSchema.array().safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            operation: "getCachedCalendars",
            message: `Invalid cached payload: ${parsed.error.message}`,
          });
        }

        return Option.some(parsed.data);
      });

      const setCachedCalendars = Effect.fn(
        "GoogleCalendarCacheService.setCachedCalendars"
      )(function* (accountId: string, data: unknown) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        const key = calendarsKey(accountId);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, CALENDARS_TTL_SECONDS);
          },
          catch: (cause) =>
            new CacheError({
              operation: "setCachedCalendars",
              message: String(cause),
            }),
        });
      });

      /**
       * Invalidate the calendar list AND all single-calendar keys for an account.
       * Used by webhooks where we don't know which specific calendar changed.
       */
      const invalidateCalendars = Effect.fn(
        "GoogleCalendarCacheService.invalidateCalendars"
      )(function* (accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.del(calendarsKey(accountId));
            await scanAndDelete(calendarSingleKeyPrefix(accountId));
          },
          catch: (cause) =>
            new CacheError({
              operation: "invalidateCalendars",
              message: String(cause),
            }),
        });
      });

      // ── Single calendar ──────────────────────────────────────────

      const getCachedCalendar = Effect.fn(
        "GoogleCalendarCacheService.getCachedCalendar"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        const raw = yield* Effect.tryPromise({
          try: () => redis.get(calendarKey(accountId, calendarId)),
          catch: (cause) =>
            new CacheError({
              operation: "getCachedCalendar",
              message: String(cause),
            }),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new CacheError({
              operation: "getCachedCalendar",
              message: `Invalid cached JSON: ${String(cause)}`,
            }),
        });

        const parsed = CalendarSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            operation: "getCachedCalendar",
            message: `Invalid cached payload: ${parsed.error.message}`,
          });
        }

        return Option.some(parsed.data);
      });

      const setCachedCalendar = Effect.fn(
        "GoogleCalendarCacheService.setCachedCalendar"
      )(function* (accountId: string, calendarId: string, data: unknown) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        const key = calendarKey(accountId, calendarId);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, CALENDARS_TTL_SECONDS);
          },
          catch: (cause) =>
            new CacheError({
              operation: "setCachedCalendar",
              message: String(cause),
            }),
        });
      });

      /** Invalidate a single cached calendar by its exact key. */
      const invalidateCalendar = Effect.fn(
        "GoogleCalendarCacheService.invalidateCalendar"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.tryPromise({
          try: () => redis.del(calendarKey(accountId, calendarId)),
          catch: (cause) =>
            new CacheError({
              operation: "invalidateCalendar",
              message: String(cause),
            }),
        });
      });

      // ── Colors ──────────────────────────────────────────────────

      const getCachedColors = Effect.fn(
        "GoogleCalendarCacheService.getCachedColors"
      )(function* (accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        const raw = yield* Effect.tryPromise({
          try: () => redis.get(colorsKey(accountId)),
          catch: (cause) =>
            new CacheError({
              operation: "getCachedColors",
              message: String(cause),
            }),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new CacheError({
              operation: "getCachedColors",
              message: `Invalid cached JSON: ${String(cause)}`,
            }),
        });

        const parsed = ColorsSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            operation: "getCachedColors",
            message: `Invalid cached payload: ${parsed.error.message}`,
          });
        }

        return Option.some(parsed.data);
      });

      const setCachedColors = Effect.fn(
        "GoogleCalendarCacheService.setCachedColors"
      )(function* (accountId: string, data: unknown) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        const key = colorsKey(accountId);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, COLORS_TTL_SECONDS);
          },
          catch: (cause) =>
            new CacheError({
              operation: "setCachedColors",
              message: String(cause),
            }),
        });
      });

      // ── Events ──────────────────────────────────────────────────

      const getCachedEvents = Effect.fn(
        "GoogleCalendarCacheService.getCachedEvents"
      )(function* (
        accountId: string,
        calendarId: string,
        timeMin: string,
        timeMax: string
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        const raw = yield* Effect.tryPromise({
          try: () =>
            redis.get(eventsKey(accountId, calendarId, timeMin, timeMax)),
          catch: (cause) =>
            new CacheError({
              operation: "getCachedEvents",
              message: String(cause),
            }),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new CacheError({
              operation: "getCachedEvents",
              message: `Invalid cached JSON: ${String(cause)}`,
            }),
        });

        const parsed = EventSchema.array().safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            operation: "getCachedEvents",
            message: `Invalid cached payload: ${parsed.error.message}`,
          });
        }

        return Option.some(parsed.data);
      });

      const setCachedEvents = Effect.fn(
        "GoogleCalendarCacheService.setCachedEvents"
      )(function* (
        accountId: string,
        calendarId: string,
        timeMin: string,
        timeMax: string,
        data: Event[]
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        const key = eventsKey(accountId, calendarId, timeMin, timeMax);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, EVENTS_TTL_SECONDS);
          },
          catch: (cause) =>
            new CacheError({
              operation: "setCachedEvents",
              message: String(cause),
            }),
        });
      });

      // ── Single event ────────────────────────────────────────────

      const getCachedEvent = Effect.fn(
        "GoogleCalendarCacheService.getCachedEvent"
      )(function* (accountId: string, calendarId: string, eventId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        const raw = yield* Effect.tryPromise({
          try: () => redis.get(eventSingleKey(accountId, calendarId, eventId)),
          catch: (cause) =>
            new CacheError({
              operation: "getCachedEvent",
              message: String(cause),
            }),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            new CacheError({
              operation: "getCachedEvent",
              message: `Invalid cached JSON: ${String(cause)}`,
            }),
        });

        const parsed = EventSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            operation: "getCachedEvent",
            message: `Invalid cached payload: ${parsed.error.message}`,
          });
        }

        return Option.some(parsed.data);
      });

      const setCachedEvent = Effect.fn(
        "GoogleCalendarCacheService.setCachedEvent"
      )(function* (
        accountId: string,
        calendarId: string,
        eventId: string,
        data: unknown
      ) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        const key = eventSingleKey(accountId, calendarId, eventId);
        yield* Effect.tryPromise({
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, EVENTS_TTL_SECONDS);
          },
          catch: (cause) =>
            new CacheError({
              operation: "setCachedEvent",
              message: String(cause),
            }),
        });
      });

      // ── Invalidation ────────────────────────────────────────────

      /**
       * Invalidate ALL event-related cache for a calendar (list + single-event keys).
       * Used by webhooks where we don't know which specific event changed.
       */
      const invalidateAllEvents = Effect.fn(
        "GoogleCalendarCacheService.invalidateAllEvents"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.tryPromise({
          try: async () => {
            await scanAndDelete(eventsListKeyPrefix(accountId, calendarId));
            await scanAndDelete(eventSingleKeyPrefix(accountId, calendarId));
          },
          catch: (cause) =>
            new CacheError({
              operation: "invalidateAllEvents",
              message: String(cause),
            }),
        });
      });

      /**
       * Invalidate only event list cache for a calendar.
       * Used by local mutations — the list has changed but unrelated single-event
       * keys (e.g. other master recurring events) can stay cached.
       */
      const invalidateEventLists = Effect.fn(
        "GoogleCalendarCacheService.invalidateEventLists"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.tryPromise({
          try: () => scanAndDelete(eventsListKeyPrefix(accountId, calendarId)),
          catch: (cause) =>
            new CacheError({
              operation: "invalidateEventLists",
              message: String(cause),
            }),
        });
      });

      /** Invalidate a single cached event by its exact key. */
      const invalidateEvent = Effect.fn(
        "GoogleCalendarCacheService.invalidateEvent"
      )(function* (accountId: string, calendarId: string, eventId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.annotateCurrentSpan("eventId", eventId);
        yield* Effect.tryPromise({
          try: () => redis.del(eventSingleKey(accountId, calendarId, eventId)),
          catch: (cause) =>
            new CacheError({
              operation: "invalidateEvent",
              message: String(cause),
            }),
        });
      });

      return {
        getCachedCalendars,
        setCachedCalendars,
        invalidateCalendars,
        getCachedCalendar,
        setCachedCalendar,
        invalidateCalendar,
        getCachedColors,
        setCachedColors,
        getCachedEvents,
        setCachedEvents,
        getCachedEvent,
        setCachedEvent,
        invalidateAllEvents,
        invalidateEventLists,
        invalidateEvent,
      };
    }),
  }
) {}
