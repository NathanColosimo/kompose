import {
  CalendarSchema,
  ColorsSchema,
  EventSchema,
} from "@kompose/google-cal/schema";
import { Context, Effect, Layer } from "effect";
import type { LinkedAccount } from "../../lib/linked-account";
import { makeRedisJsonCache } from "../../lib/redis-cache";

/** TTLs backstop webhook invalidation. See documents/caching.md. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

type CacheAccount = Pick<LinkedAccount, "accountId" | "id" | "userId">;

function accountKey(link: CacheAccount): string {
  return `${link.userId}:${link.accountId}:${link.id}`;
}

function calendarsGenerationKey(link: CacheAccount): string {
  return `gcal:calendars-generation:${accountKey(link)}`;
}

function eventsGenerationKey(link: CacheAccount, calendarId: string): string {
  return `gcal:events-generation:${accountKey(link)}:${calendarId}`;
}

export class GoogleCalendarCacheService extends Context.Service<GoogleCalendarCacheService>()(
  "GoogleCalendarCacheService",
  {
    make: Effect.sync(() => {
      const cache = makeRedisJsonCache("CACHE_ERROR");

      const calendars = Effect.fn("GoogleCalendarCacheService.calendars")(
        function* (link: CacheAccount) {
          yield* Effect.annotateCurrentSpan("accountId", link.accountId);
          return yield* cache.versionedEntry(
            "calendars",
            `gcal:cals:${accountKey(link)}`,
            calendarsGenerationKey(link),
            CalendarSchema.array(),
            CACHE_TTL_SECONDS
          );
        }
      );

      const calendar = Effect.fn("GoogleCalendarCacheService.calendar")(
        function* (link: CacheAccount, calendarId: string) {
          yield* Effect.annotateCurrentSpan("accountId", link.accountId);
          yield* Effect.annotateCurrentSpan("calendarId", calendarId);
          return yield* cache.versionedEntry(
            "calendar",
            `gcal:cal:${accountKey(link)}:${calendarId}`,
            calendarsGenerationKey(link),
            CalendarSchema,
            CACHE_TTL_SECONDS
          );
        }
      );

      const colors = Effect.fn("GoogleCalendarCacheService.colors")(function* (
        link: CacheAccount
      ) {
        yield* Effect.annotateCurrentSpan("accountId", link.accountId);
        return cache.entry(
          "colors",
          `gcal:colors:${accountKey(link)}`,
          ColorsSchema,
          CACHE_TTL_SECONDS
        );
      });

      const events = Effect.fn("GoogleCalendarCacheService.events")(function* (
        link: CacheAccount,
        params: { calendarId: string; timeMin: string; timeMax: string }
      ) {
        yield* Effect.annotateCurrentSpan("accountId", link.accountId);
        yield* Effect.annotateCurrentSpan("calendarId", params.calendarId);
        return yield* cache.versionedEntry(
          "events",
          `gcal:events:${accountKey(link)}:${params.calendarId}:${params.timeMin}:${params.timeMax}`,
          eventsGenerationKey(link, params.calendarId),
          EventSchema.array(),
          CACHE_TTL_SECONDS
        );
      });

      const event = Effect.fn("GoogleCalendarCacheService.event")(function* (
        link: CacheAccount,
        params: { calendarId: string; eventId: string }
      ) {
        yield* Effect.annotateCurrentSpan("accountId", link.accountId);
        yield* Effect.annotateCurrentSpan("calendarId", params.calendarId);
        yield* Effect.annotateCurrentSpan("eventId", params.eventId);
        return yield* cache.versionedEntry(
          "event",
          `gcal:event:${accountKey(link)}:${params.calendarId}:${params.eventId}`,
          eventsGenerationKey(link, params.calendarId),
          EventSchema,
          CACHE_TTL_SECONDS
        );
      });

      const invalidateCalendars = Effect.fn(
        "GoogleCalendarCacheService.invalidateCalendars"
      )(function* (link: CacheAccount) {
        yield* Effect.annotateCurrentSpan("accountId", link.accountId);
        yield* cache.invalidate(
          "invalidateCalendars",
          calendarsGenerationKey(link)
        );
      });

      // Recurring mutations can change other instances as well as the supplied ID.
      // All lists and singles for a calendar share one generation.
      const invalidateEvents = Effect.fn(
        "GoogleCalendarCacheService.invalidateEvents"
      )(function* (link: CacheAccount, calendarId: string) {
        yield* Effect.annotateCurrentSpan("accountId", link.accountId);
        yield* Effect.annotateCurrentSpan("calendarId", calendarId);
        yield* cache.invalidate(
          "invalidateEvents",
          eventsGenerationKey(link, calendarId)
        );
      });

      return {
        calendar,
        calendars,
        colors,
        event,
        events,
        invalidateCalendars,
        invalidateEvents,
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
