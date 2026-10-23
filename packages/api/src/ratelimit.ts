import { env } from "@kompose/env";
import { ratelimit } from "@orpc/ratelimit";
import {
  BaseRedisRateLimiter,
  type BaseRedisRateLimiterOptions,
} from "@orpc/ratelimit/base-redis";
import { RedisClient } from "bun";
import type { Context } from "./context";

/** Dedicated Redis client for rate limiting (separate from pub/sub client) */
const redisClient = new RedisClient(env.REDIS_URL);

/**
 * oRPC's built-in Redis adapter expects a node-redis client, so this adapter
 * runs the same fixed-window Lua script through Bun's Redis client instead.
 */
class BunRedisRateLimiter extends BaseRedisRateLimiter {
  readonly #client: RedisClient;

  constructor(client: RedisClient, options: BaseRedisRateLimiterOptions) {
    super(options);
    this.#client = client;
  }

  protected evalScript(
    script: string,
    keys: string[],
    args: string[]
  ): Promise<unknown> {
    return this.#client.send("EVAL", [
      script,
      keys.length.toString(),
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
const globalLimiter = new BunRedisRateLimiter(redisClient, {
  maxRequests: 200,
  prefix: "orpc:ratelimit:global:",
  window: 60_000,
});

/**
 * Maps rate limiter: 20 requests per 60 seconds per user.
 * Tighter limit because maps search hits the external Google Places API
 * which has per-request costs.
 */
const mapsLimiter = new BunRedisRateLimiter(redisClient, {
  maxRequests: 20,
  prefix: "orpc:ratelimit:maps:",
  window: 60_000,
});

type AuthedContext = Context & { user: NonNullable<Context["user"]> };

/** Global rate limit middleware — apply after requireAuth on all routers */
export const globalRateLimit = ratelimit<AuthedContext, unknown>({
  key: ({ context }) => context.user.id,
  limiter: globalLimiter,
});

/** Maps-specific rate limit middleware — apply on the maps router only */
export const mapsRateLimit = ratelimit<AuthedContext, unknown>({
  key: ({ context }) => context.user.id,
  limiter: mapsLimiter,
});
