import {
  type WhoopCachedDayRaw,
  whoopCachedDayRawSchema,
} from "@kompose/whoop/schema";
import { Context, Effect, Layer, Option } from "effect";
import type { LinkedAccount } from "../../lib/linked-account";
import { makeRedisJsonCache } from "../../lib/redis-cache";

function dayKey(link: LinkedAccount, day: string): string {
  return `whoop:day:${link.userId}:${link.accountId}:${link.id}:${day}`;
}

export class WhoopCacheService extends Context.Service<WhoopCacheService>()(
  "WhoopCacheService",
  {
    make: Effect.sync(() => {
      const cache = makeRedisJsonCache("WHOOP_CACHE_ERROR");

      const getCachedDay = Effect.fn("WhoopCacheService.getCachedDay")(
        function* (link: LinkedAccount, day: string) {
          yield* Effect.annotateCurrentSpan("accountId", link.accountId);
          yield* Effect.annotateCurrentSpan("day", day);
          return yield* cache.get(
            "getCachedDay",
            dayKey(link, day),
            whoopCachedDayRawSchema
          );
        }
      );

      /** The cached days among `days`; a day that fails to load is left out. */
      const getCachedDays = Effect.fn("WhoopCacheService.getCachedDays")(
        function* (link: LinkedAccount, days: string[]) {
          yield* Effect.annotateCurrentSpan("accountId", link.accountId);
          yield* Effect.annotateCurrentSpan("days", JSON.stringify(days));

          const entries = yield* Effect.forEach(
            days,
            (day) =>
              getCachedDay(link, day).pipe(
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
          link: LinkedAccount,
          payload: WhoopCachedDayRaw,
          ttlSeconds: number
        ) {
          yield* Effect.annotateCurrentSpan("accountId", link.accountId);
          yield* Effect.annotateCurrentSpan("day", payload.day);
          yield* cache.set(
            "setCachedDay",
            dayKey(link, payload.day),
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
