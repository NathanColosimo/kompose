import { env } from "@kompose/env";
import { Redis } from "ioredis";

/**
 * Omit `command`: ioredis attaches command arguments to server errors,
 * which can include AUTH credentials.
 */
function logError(error: Error) {
  console.error("REDIS_ERROR", {
    message: error.message,
    name: error.name,
    stack: error.stack,
  });
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
 * Isolate each subscriber's channels and lifetime from the shared command
 * connection. The caller disconnects it when done.
 */
export function createSubscriber(): Redis {
  const subscriber = redis.duplicate();
  subscriber.on("error", logError);
  return subscriber;
}
