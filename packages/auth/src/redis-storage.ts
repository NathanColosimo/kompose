import { env } from "@kompose/env";
import type { SecondaryStorage } from "better-auth";
import { RedisClient } from "bun";

const KEY_PREFIX = "better-auth:";

/** Redis client dedicated to Better Auth secondary storage (sessions, rate limits). */
const redisClient = new RedisClient(env.REDIS_URL);

/**
 * Redis-backed secondary storage for Better Auth.
 *
 * Stores session data and rate limit counters in Redis instead of Postgres,
 * reducing database load on high-frequency operations like getSession
 * (called on every oRPC request via createContext).
 */
export const redisSecondaryStorage: SecondaryStorage = {
  async get(key) {
    const value = await redisClient.get(`${KEY_PREFIX}${key}`);
    return value ?? null;
  },
  async set(key, value, ttl) {
    const prefixedKey = `${KEY_PREFIX}${key}`;
    await redisClient.set(prefixedKey, value);
    if (ttl) {
      await redisClient.expire(prefixedKey, ttl);
    }
  },
  async delete(key) {
    await redisClient.del(`${KEY_PREFIX}${key}`);
  },
};
