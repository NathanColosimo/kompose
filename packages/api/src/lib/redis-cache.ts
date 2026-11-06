import { redis } from "@kompose/redis";
import { Effect, Option } from "effect";
import type { z } from "zod";

/**
 * Cache failures must not fail requests: log them as `logEvent`, treat failed
 * reads as misses and ignore failed writes/invalidations. See documents/caching.md.
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

  const entry = <T>(
    operation: string,
    key: string,
    schema: z.ZodType<T>,
    ttlSeconds: number
  ) => ({
    get: get(operation, key, schema).pipe(
      Effect.withSpan(`RedisJsonCache.${operation}.get`)
    ),
    set: (value: T) =>
      set(operation, key, value, ttlSeconds).pipe(
        Effect.withSpan(`RedisJsonCache.${operation}.set`)
      ),
  });

  // Capture once, before the provider fetch. A late write must never look up
  // the new generation and repopulate it with an old provider response.
  const versionedEntry = <T>(
    operation: string,
    key: string,
    generationKey: string,
    schema: z.ZodType<T>,
    ttlSeconds: number
  ) =>
    Effect.tryPromise({
      catch: String,
      try: () => redis.get(generationKey),
    }).pipe(
      Effect.map((generation) => Option.some(generation ?? "0")),
      Effect.catch(logAndReturn(operation, Option.none<string>())),
      Effect.map((generation) => {
        if (Option.isNone(generation)) {
          // A failed generation lookup cannot safely choose a namespace.
          return {
            get: Effect.succeed(Option.none<T>()),
            set: (_value: T) => Effect.void,
          };
        }
        return entry(
          operation,
          `${key}:${generation.value}`,
          schema,
          ttlSeconds
        );
      })
    );

  const invalidate = (operation: string, generationKey: string) =>
    Effect.tryPromise({
      catch: String,
      try: () => redis.incr(generationKey),
    }).pipe(Effect.asVoid, Effect.catch(logAndReturn(operation, undefined)));

  return { entry, get, invalidate, set, versionedEntry };
}
