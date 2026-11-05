import { redis } from "@kompose/redis";
import { Effect, Option } from "effect";
import type { z } from "zod";

/** Use incremental SCAN calls instead of blocking Redis with KEYS. */
async function deleteKeysWithPrefix(prefix: string) {
  let cursor = "0";
  do {
    // biome-ignore lint/performance/noAwaitInLoops: SCAN is cursor-dependent
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

/**
 * Cache failures must not fail requests: log them as `logEvent`, treat failed
 * reads as misses and ignore failed writes/deletes. See documents/caching.md.
 */
export function makeRedisJsonCache(logEvent: string) {
  const logAndReturn =
    <A>(operation: string, fallback: A) =>
    (message: string) =>
      Effect.logError(logEvent, { message, operation }).pipe(
        Effect.as(fallback)
      );

  const get = <T>(operation: string, key: string, schema: z.ZodType<T>) =>
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        catch: String,
        try: () => redis.get(key),
      });
      if (raw === null) {
        return Option.none<T>();
      }

      const payload = yield* Effect.try({
        catch: (cause) => `Invalid cached JSON: ${String(cause)}`,
        try: () => JSON.parse(raw) as unknown,
      });
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        return yield* Effect.fail(
          `Invalid cached payload: ${parsed.error.message}`
        );
      }
      return Option.some(parsed.data);
    }).pipe(Effect.catch(logAndReturn(operation, Option.none<T>())));

  const set = (
    operation: string,
    key: string,
    value: unknown,
    ttlSeconds: number
  ) =>
    Effect.tryPromise({
      catch: String,
      try: () => redis.set(key, JSON.stringify(value), "EX", ttlSeconds),
    }).pipe(Effect.asVoid, Effect.catch(logAndReturn(operation, undefined)));

  const remove = (
    operation: string,
    { keys = [], prefixes = [] }: { keys?: string[]; prefixes?: string[] }
  ) =>
    Effect.tryPromise({
      catch: String,
      try: async () => {
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        for (const prefix of prefixes) {
          // biome-ignore lint/performance/noAwaitInLoops: one prefix at a time
          await deleteKeysWithPrefix(prefix);
        }
      },
    }).pipe(Effect.catch(logAndReturn(operation, undefined)));

  return { get, remove, set };
}
