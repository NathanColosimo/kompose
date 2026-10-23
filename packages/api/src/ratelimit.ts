import { env } from "@kompose/env";
import { ratelimit } from "@orpc/ratelimit";
import { BaseRedisRateLimiter } from "@orpc/ratelimit/base-redis";
import type { User } from "better-auth";
import { RedisClient } from "bun";

/** Dedicated Redis client for rate limiting (separate from pub/sub client) */
const redisClient = new RedisClient(env.REDIS_URL);

/** oRPC's Redis rate limiter, run through Bun's Redis client */
class BunRedisRateLimiter extends BaseRedisRateLimiter {
  protected evalScript(script: string, keys: string[], args: string[]) {
    return redisClient.send("EVAL", [
      script,
      String(keys.length),
      ...keys,
      ...args,
    ]);
  }
}

/**
 * Global rate limiter: 200 requests per 60 seconds per user.
 * Covers all authenticated endpoints as a baseline protection
 * against runaway clients or compromised accounts.
 */
const globalLimiter = new BunRedisRateLimiter({
  maxRequests: 200,
  prefix: "orpc:ratelimit:global:",
  window: 60_000,
});

/**
 * Maps rate limiter: 20 requests per 60 seconds per user.
 * Tighter limit because maps search hits the external Google Places API
 * which has per-request costs.
 */
const mapsLimiter = new BunRedisRateLimiter({
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
