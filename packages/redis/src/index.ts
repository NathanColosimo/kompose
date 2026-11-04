import { env } from "@kompose/env";
import { Redis } from "ioredis";

function logError(error: Error) {
  console.error("REDIS_ERROR", error);
}

/**
 * The Redis connection a server instance shares for every command: Better
 * Auth's secondary storage, rate limits, caches and sync publishes.
 *
 * Commands sent in the same tick go out as one pipeline. The connection opens
 * on import, so on a cold start its TLS handshake overlaps module loading
 * instead of delaying the first command.
 */
export const redis = new Redis(env.REDIS_URL, { enableAutoPipelining: true });
redis.on("error", logError);

/**
 * A new connection for SUBSCRIBE, which can't share the command connection:
 * a subscribed connection only takes (un)subscribe commands. The caller
 * disconnects it when done.
 */
export function createSubscriber(): Redis {
  const subscriber = redis.duplicate();
  subscriber.on("error", logError);
  return subscriber;
}
