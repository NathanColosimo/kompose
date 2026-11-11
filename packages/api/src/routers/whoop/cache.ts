import {
  type WhoopCachedDayRaw,
  whoopCachedDayRawSchema,
} from "@kompose/whoop/schema";
import { Context, Effect, Layer, Option } from "effect";
import { makeRedisJsonCache } from "../../lib/redis-cache";

const KEY_PREFIX = "whoop";

// accountId is the owned local account row ID, checked before cache access.
// Relinking creates a new row and therefore fresh cache keys.
function dayKey(userId: string, accountId: string, day: string): string {
  return `${KEY_PREFIX}:day:${userId}:${accountId}:${day}`;
}

export class WhoopCacheService extends Context.Service<WhoopCacheService>()(
  "WhoopCacheService",
  {
    make: Effect.sync(() => {
      const cache = makeRedisJsonCache("WHOOP_CACHE_ERROR");

      const getCachedDay = Effect.fn("WhoopCacheService.getCachedDay")(
        function* (userId: string, accountId: string, day: string) {
          yield* Effect.annotateCurrentSpan("accountId", accountId);
          yield* Effect.annotateCurrentSpan("day", day);
          return yield* cache.get(
            "getCachedDay",
            dayKey(userId, accountId, day),
            whoopCachedDayRawSchema
          );
        }
      );

      /** The cached days among `days`; a day that fails to load is left out. */
      const getCachedDays = Effect.fn("WhoopCacheService.getCachedDays")(
        function* (userId: string, accountId: string, days: string[]) {
          yield* Effect.annotateCurrentSpan("accountId", accountId);
          yield* Effect.annotateCurrentSpan("days", JSON.stringify(days));

          const entries = yield* Effect.forEach(
            days,
            (day) =>
              getCachedDay(userId, accountId, day).pipe(
                Effect.map((payload) => [day, payload] as const)
              ),
            { concurrency: "unbounded" }
          );

          const result = new Map<string, WhoopCachedDayRaw>();
          for (const [day, payload] of entries) {
            if (Option.isSome(payload)) {
              result.set(day, payload.value);
            }
          }
          return result;
        }
      );

      const setCachedDay = Effect.fn("WhoopCacheService.setCachedDay")(
        function* (
          userId: string,
          accountId: string,
          day: string,
          payload: WhoopCachedDayRaw,
          ttlSeconds: number
        ) {
          yield* Effect.annotateCurrentSpan("accountId", accountId);
          yield* Effect.annotateCurrentSpan("day", day);
          yield* cache.set(
            "setCachedDay",
            dayKey(userId, accountId, day),
            payload,
            ttlSeconds
          );
        }
      );

      return { getCachedDays, setCachedDay };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
