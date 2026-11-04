import { env } from "@kompose/env";
import {
  type WhoopCachedDayRaw,
  whoopCachedDayRawSchema,
} from "@kompose/whoop/schema";
import { RedisClient } from "bun";
import { Context, Effect, Layer } from "effect";
import { WhoopCacheError } from "./errors";

const KEY_PREFIX = "whoop";

const redis = new RedisClient(env.REDIS_URL);

// Keys start with the user ID. An entry is written only after that user's own
// token fetch for the account succeeded, so a cache hit needs no ownership check.
function dayKey(userId: string, accountId: string, day: string): string {
  return `${KEY_PREFIX}:day:${userId}:${accountId}:${day}`;
}

function accountDayPrefix(userId: string, accountId: string): string {
  return `${KEY_PREFIX}:day:${userId}:${accountId}:`;
}

export const logAndSwallowWhoopCacheError = <A, R>(
  self: Effect.Effect<A, WhoopCacheError, R>
) =>
  self.pipe(
    Effect.catchTag("WhoopCacheError", (error) =>
      Effect.logError("WHOOP_CACHE_ERROR", error)
    )
  );

export const logWhoopCacheErrorAndFallback =
  <A>(fallback: A) =>
  <R>(self: Effect.Effect<A, WhoopCacheError, R>) =>
    self.pipe(
      Effect.catchTag("WhoopCacheError", (error) =>
        Effect.logError("WHOOP_CACHE_ERROR", error).pipe(
          Effect.map(() => fallback)
        )
      )
    );

export class WhoopCacheService extends Context.Service<WhoopCacheService>()(
  "WhoopCacheService",
  {
    make: Effect.gen(function* () {
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

      const getCachedDay = Effect.fn("WhoopCacheService.getCachedDay")(
        function* (userId: string, accountId: string, day: string) {
          yield* Effect.annotateCurrentSpan("accountId", accountId);
          yield* Effect.annotateCurrentSpan("day", day);
          const raw = yield* Effect.tryPromise({
            catch: (cause) =>
              new WhoopCacheError({
                message: String(cause),
                operation: "getCachedDay",
              }),
            try: () => redis.get(dayKey(userId, accountId, day)),
          });

          if (raw === null) {
            return null;
          }

          const payload = yield* Effect.try({
            catch: (cause) =>
              new WhoopCacheError({
                message: `Invalid cached JSON: ${String(cause)}`,
                operation: "getCachedDay",
              }),
            try: () => JSON.parse(raw) as unknown,
          });

          const parsed = whoopCachedDayRawSchema.safeParse(payload);
          if (!parsed.success) {
            return yield* new WhoopCacheError({
              message: `Invalid cached payload: ${parsed.error.message}`,
              operation: "getCachedDay",
            });
          }

          return parsed.data;
        }
      );

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
            if (payload) {
              result.set(day, payload);
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
          const validatedPayload = yield* Effect.try({
            catch: (cause) =>
              new WhoopCacheError({
                message: `Invalid cache payload: ${String(cause)}`,
                operation: "setCachedDay",
              }),
            try: () => whoopCachedDayRawSchema.parse(payload),
          });

          yield* Effect.tryPromise({
            catch: (cause) =>
              new WhoopCacheError({
                message: String(cause),
                operation: "setCachedDay",
              }),
            try: async () => {
              const key = dayKey(userId, accountId, day);
              await redis.set(key, JSON.stringify(validatedPayload));
              await redis.expire(key, ttlSeconds);
            },
          });
        }
      );

      const invalidateDay = Effect.fn("WhoopCacheService.invalidateDay")(
        function* (userId: string, accountId: string, day: string) {
          yield* Effect.annotateCurrentSpan("accountId", accountId);
          yield* Effect.annotateCurrentSpan("day", day);
          yield* Effect.tryPromise({
            catch: (cause) =>
              new WhoopCacheError({
                message: String(cause),
                operation: "invalidateDay",
              }),
            try: () => redis.del(dayKey(userId, accountId, day)),
          });
        }
      );

      const invalidateAccount = Effect.fn(
        "WhoopCacheService.invalidateAccount"
      )(function* (userId: string, accountId: string) {
        yield* Effect.annotateCurrentSpan("accountId", accountId);
        yield* Effect.tryPromise({
          catch: (cause) =>
            new WhoopCacheError({
              message: String(cause),
              operation: "invalidateAccount",
            }),
          try: () => scanAndDelete(accountDayPrefix(userId, accountId)),
        });
      });

      return {
        getCachedDay,
        getCachedDays,
        invalidateAccount,
        invalidateDay,
        setCachedDay,
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
