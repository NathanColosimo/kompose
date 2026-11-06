import { createSubscriber, redis } from "@kompose/redis";
import { Effect } from "effect";
import type { SyncEvent } from "./events";
import { createSyncEventStream } from "./sync-stream";

const USER_CHANNEL_PREFIX = "user";
export function getUserSyncChannel(userId: string): string {
  return `${USER_CHANNEL_PREFIX}:${userId}`;
}

/**
 * Publish a sync event to a user's Redis channel. Best effort: a failed
 * publish is logged as SYNC_PUBLISH_ERROR and never fails the caller.
 */
export const publishToUser = Effect.fn("sync.publish")(
  function* (userId: string, event: SyncEvent) {
    yield* Effect.annotateCurrentSpan("userId", userId);
    yield* Effect.annotateCurrentSpan("eventType", event.type);
    yield* Effect.tryPromise({
      catch: String,
      try: () =>
        redis.publish(getUserSyncChannel(userId), JSON.stringify(event)),
    });
  },
  Effect.catch((message) => Effect.logError("SYNC_PUBLISH_ERROR", { message }))
);

/**
 * Abort closes the queue immediately so a disconnected client doesn't keep
 * the function and Redis subscription alive until the next keepalive.
 * See documents/services.md for the SSE lifecycle.
 */
export function createUserSyncEventIterator(
  userId: string,
  signal?: AbortSignal
): AsyncGenerator<SyncEvent, void, unknown> {
  return createSyncEventStream({
    channel: getUserSyncChannel(userId),
    createSubscriber,
    signal,
    userId,
  });
}
