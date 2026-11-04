import { redis } from "@kompose/redis";
import { ratelimit } from "@orpc/ratelimit";
import { BaseRedisRateLimiter } from "@orpc/ratelimit/base-redis";
import type { User } from "better-auth";

/** oRPC's Redis rate limiter, run through the shared Redis connection */
class RedisRateLimiter extends BaseRedisRateLimiter {
  protected evalScript(script: string, keys: string[], args: string[]) {
    return redis.eval(script, keys.length, ...keys, ...args);
  }
}

/**
 * Global rate limiter: 200 requests per 60 seconds per user.
 * Covers all authenticated endpoints as a baseline protection
 * against runaway clients or compromised accounts.
 */
const globalLimiter = new RedisRateLimiter({
  maxRequests: 200,
  prefix: "orpc:ratelimit:global:",
  window: 60_000,
});

/**
 * Maps rate limiter: 20 requests per 60 seconds per user.
 * Tighter limit because maps search hits the external Google Places API
 * which has per-request costs.
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

/** Maps-specific rate limit middleware — apply on the maps router only */
export const mapsRateLimit = ratelimit<{ user: User }, unknown>({
  key: ({ context }) => context.user.id,
  limiter: mapsLimiter,
});
