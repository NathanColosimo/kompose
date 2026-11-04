import { redis } from "@kompose/redis";
import type { SecondaryStorage } from "better-auth";

const KEY_PREFIX = "better-auth:";
const INCREMENT_WITH_TTL_SCRIPT = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;

/**
 * Redis-backed secondary storage for Better Auth.
 *
 * Stores session data and rate limit counters in Redis instead of Postgres,
 * reducing database load on high-frequency operations like getSession
 * (called on every oRPC request via createContext).
 */
export const redisSecondaryStorage: SecondaryStorage = {
  async delete(key) {
    await redis.del(`${KEY_PREFIX}${key}`);
  },
  async get(key) {
    const value = await redis.get(`${KEY_PREFIX}${key}`);
    return value ?? null;
  },
  async getAndDelete(key) {
    return await redis.getdel(`${KEY_PREFIX}${key}`);
  },
  async increment(key, ttl) {
    if (!(Number.isInteger(ttl) && ttl > 0)) {
      throw new TypeError("Redis increment TTL must be a positive integer.");
    }

    const value = await redis.eval(
      INCREMENT_WITH_TTL_SCRIPT,
      1,
      `${KEY_PREFIX}${key}`,
      ttl
    );
    return Number(value);
  },
  async set(key, value, ttl) {
    const prefixedKey = `${KEY_PREFIX}${key}`;
    if (ttl) {
      await redis.set(prefixedKey, value, "EX", ttl);
      return;
    }
    await redis.set(prefixedKey, value);
  },
};
