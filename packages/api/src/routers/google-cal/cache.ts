import { env } from "@kompose/env";
import {
  CalendarSchema,
  ColorsSchema,
  type Event,
  EventSchema,
} from "@kompose/google-cal/schema";
import { RedisClient } from "bun";
import { Context, Effect, Layer, Option } from "effect";
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
const EVENTS_TTL_SECONDS = 24 * 60 * 60; // 1 hour

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

export class GoogleCalendarCacheService extends Context.Service<GoogleCalendarCacheService>()(
  "GoogleCalendarCacheService",
  {
    make: Effect.gen(function* () {
      /** SCAN + DEL all keys matching a prefix. Avoids KEYS to not block Redis. */
      const scanAndDelete = async (prefix: string) => {
        let cursor = 0;
        do {
          // Redis SCAN cursors are sequential: each request needs the cursor
          // returned by the previous request.
          // biome-ignore lint/performance/noAwaitInLoops: SCAN is cursor-dependent
          const [nextCursor, keys] = (await redis.send("SCAN", [
            cursor.toString(),
            "MATCH",
            `${prefix}*`,
            "COUNT",
            "100",
          ])) as [string, string[]];
          cursor = Number(nextCursor);
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "getCachedCalendars",
            }),
          try: () => redis.get(calendarsKey(accountId)),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          catch: (cause) =>
            new CacheError({
              message: `Invalid cached JSON: ${String(cause)}`,
              operation: "getCachedCalendars",
            }),
          try: () => JSON.parse(raw) as unknown,
        });

        const parsed = CalendarSchema.array().safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            message: `Invalid cached payload: ${parsed.error.message}`,
            operation: "getCachedCalendars",
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "setCachedCalendars",
            }),
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, CALENDARS_TTL_SECONDS);
          },
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "invalidateCalendars",
            }),
          try: async () => {
            await redis.del(calendarsKey(accountId));
            await scanAndDelete(calendarSingleKeyPrefix(accountId));
          },
        });
      });

      // ── Single calendar ──────────────────────────────────────────

      const getCachedCalendar = Effect.fn(
        "GoogleCalendarCacheService.getCachedCalendar"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        const raw = yield* Effect.tryPromise({
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "getCachedCalendar",
            }),
          try: () => redis.get(calendarKey(accountId, calendarId)),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          catch: (cause) =>
            new CacheError({
              message: `Invalid cached JSON: ${String(cause)}`,
              operation: "getCachedCalendar",
            }),
          try: () => JSON.parse(raw) as unknown,
        });

        const parsed = CalendarSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            message: `Invalid cached payload: ${parsed.error.message}`,
            operation: "getCachedCalendar",
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "setCachedCalendar",
            }),
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, CALENDARS_TTL_SECONDS);
          },
        });
      });

      /** Invalidate a single cached calendar by its exact key. */
      const invalidateCalendar = Effect.fn(
        "GoogleCalendarCacheService.invalidateCalendar"
      )(function* (accountId: string, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* Effect.tryPromise({
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "invalidateCalendar",
            }),
          try: () => redis.del(calendarKey(accountId, calendarId)),
        });
      });

      // ── Colors ──────────────────────────────────────────────────

      const getCachedColors = Effect.fn(
        "GoogleCalendarCacheService.getCachedColors"
      )(function* (accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        const raw = yield* Effect.tryPromise({
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "getCachedColors",
            }),
          try: () => redis.get(colorsKey(accountId)),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          catch: (cause) =>
            new CacheError({
              message: `Invalid cached JSON: ${String(cause)}`,
              operation: "getCachedColors",
            }),
          try: () => JSON.parse(raw) as unknown,
        });

        const parsed = ColorsSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            message: `Invalid cached payload: ${parsed.error.message}`,
            operation: "getCachedColors",
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "setCachedColors",
            }),
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, COLORS_TTL_SECONDS);
          },
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "getCachedEvents",
            }),
          try: () =>
            redis.get(eventsKey(accountId, calendarId, timeMin, timeMax)),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          catch: (cause) =>
            new CacheError({
              message: `Invalid cached JSON: ${String(cause)}`,
              operation: "getCachedEvents",
            }),
          try: () => JSON.parse(raw) as unknown,
        });

        const parsed = EventSchema.array().safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            message: `Invalid cached payload: ${parsed.error.message}`,
            operation: "getCachedEvents",
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "setCachedEvents",
            }),
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, EVENTS_TTL_SECONDS);
          },
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "getCachedEvent",
            }),
          try: () => redis.get(eventSingleKey(accountId, calendarId, eventId)),
        });
        if (raw === null) {
          return Option.none();
        }

        const payload = yield* Effect.try({
          catch: (cause) =>
            new CacheError({
              message: `Invalid cached JSON: ${String(cause)}`,
              operation: "getCachedEvent",
            }),
          try: () => JSON.parse(raw) as unknown,
        });

        const parsed = EventSchema.safeParse(payload);
        if (!parsed.success) {
          return yield* new CacheError({
            message: `Invalid cached payload: ${parsed.error.message}`,
            operation: "getCachedEvent",
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "setCachedEvent",
            }),
          try: async () => {
            await redis.set(key, JSON.stringify(data));
            await redis.expire(key, EVENTS_TTL_SECONDS);
          },
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "invalidateAllEvents",
            }),
          try: async () => {
            await scanAndDelete(eventsListKeyPrefix(accountId, calendarId));
            await scanAndDelete(eventSingleKeyPrefix(accountId, calendarId));
          },
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "invalidateEventLists",
            }),
          try: () => scanAndDelete(eventsListKeyPrefix(accountId, calendarId)),
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
          catch: (cause) =>
            new CacheError({
              message: String(cause),
              operation: "invalidateEvent",
            }),
          try: () => redis.del(eventSingleKey(accountId, calendarId, eventId)),
        });
      });

      return {
        getCachedCalendar,
        getCachedCalendars,
        getCachedColors,
        getCachedEvent,
        getCachedEvents,
        invalidateAllEvents,
        invalidateCalendar,
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
