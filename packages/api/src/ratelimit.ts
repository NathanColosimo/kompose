import { redis } from "@kompose/redis";
import { ratelimit } from "@orpc/ratelimit";
import { BaseRedisRateLimiter } from "@orpc/ratelimit/base-redis";
import type { User } from "better-auth";

class RedisRateLimiter extends BaseRedisRateLimiter {
  protected evalScript(script: string, keys: string[], args: string[]) {
    return redis.eval(script, keys.length, ...keys, ...args);
  }
}

/**
 * Baseline protection against runaway clients or compromised accounts.
 */
const globalLimiter = new RedisRateLimiter({
  maxRequests: 200,
  prefix: "orpc:ratelimit:global:",
  window: 60_000,
});

/**
 * Maps search has a tighter limit because Places charges per request.
 */
const mapsLimiter = new RedisRateLimiter({
  maxRequests: 20,
  prefix: "orpc:ratelimit:maps:",
  window: 60_000,
});

/** Global rate limit middleware — apply after requireAuth on all routers */
export const globalRateLimit = ratelimit<{ user: User }, unknown>({
  key: ({ context }) => context.user.id,
  limiter: globalLimiter,
});

export const mapsRateLimit = ratelimit<{ user: User }, unknown>({
  key: ({ context }) => context.user.id,
  limiter: mapsLimiter,
});
