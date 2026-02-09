import { env } from "@kompose/env";
import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";
import { RedisRatelimiter } from "@orpc/experimental-ratelimit/redis";
import { RedisClient } from "bun";

/** Dedicated Redis client for rate limiting (separate from pub/sub client) */
const redisClient = new RedisClient(env.REDIS_URL);

/**
 * Global rate limiter: 200 requests per 60 seconds per user.
 * Covers all authenticated endpoints as a baseline protection
 * against runaway clients or compromised accounts.
 */
const globalLimiter = new RedisRatelimiter({
  eval: async (script, numKeys, ...rest) =>
    redisClient.send("EVAL", [script, numKeys.toString(), ...rest.map(String)]),
  maxRequests: 200,
  window: 60_000,
  prefix: "orpc:ratelimit:global:",
});

/**
 * Maps rate limiter: 20 requests per 60 seconds per user.
 * Tighter limit because maps search hits the external Google Places API
 * which has per-request costs.
 */
const mapsLimiter = new RedisRatelimiter({
  eval: async (script, numKeys, ...rest) =>
    redisClient.send("EVAL", [script, numKeys.toString(), ...rest.map(String)]),
  maxRequests: 20,
  window: 60_000,
  prefix: "orpc:ratelimit:maps:",
});

/** Global rate limit middleware — apply after requireAuth on all routers */
export const globalRateLimit = createRatelimitMiddleware({
  limiter: () => globalLimiter,
  key: ({ context }) => (context as { user: { id: string } }).user.id,
});

/** Maps-specific rate limit middleware — apply on the maps router only */
export const mapsRateLimit = createRatelimitMiddleware({
  limiter: () => mapsLimiter,
  key: ({ context }) => (context as { user: { id: string } }).user.id,
});
