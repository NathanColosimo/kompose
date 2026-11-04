import { createSubscriber, redis } from "@kompose/redis";
import { trace } from "@opentelemetry/api";
import { Effect } from "effect";
import { type SyncEvent, syncEventSchema } from "./events";

const USER_CHANNEL_PREFIX = "user";
const RECONNECT_EVENT_AFTER_MS = 11 * 60 * 1000;
const KEEPALIVE_INTERVAL_MS = 10_000;
const tracer = trace.getTracer("sync");

interface AsyncQueue<T> {
  close: () => void;
  next: () => Promise<IteratorResult<T>>;
  push: (value: T) => void;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffered: T[] = [];
  let closed = false;
  let waiter: ((result: IteratorResult<T>) => void) | null = null;

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (waiter) {
        waiter({ done: true, value: undefined as T });
        waiter = null;
      }
    },
    async next() {
      if (buffered.length > 0) {
        const value = buffered.shift() as T;
        return { done: false, value };
      }
      if (closed) {
        return { done: true, value: undefined as T };
      }
      return await new Promise<IteratorResult<T>>((resolve) => {
        waiter = resolve;
      });
    },
    push(value) {
      if (closed) {
        return;
      }
      if (waiter) {
        waiter({ done: false, value });
        waiter = null;
        return;
      }
      buffered.push(value);
    },
  };
}

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
 * Long-lived async generator for SSE connections.
 * Creates an OTel span for the connection lifetime, with span events
 * for each message received and exceptions for parse failures.
 *
 * `signal` aborts when the client disconnects (clients close the stream 30 s
 * after their window loses focus). It ends the stream at once; otherwise the
 * generator, waiting on the queue, would only notice at its next keepalive,
 * keeping the function and its Redis subscription for up to 10 more seconds.
 */
export async function* createUserSyncEventIterator(
  userId: string,
  signal?: AbortSignal
): AsyncGenerator<SyncEvent, void, unknown> {
  const channel = getUserSyncChannel(userId);
  const connectionSpan = tracer.startSpan("sync.connection");
  connectionSpan.setAttribute("userId", userId);
  connectionSpan.setAttribute("channel", channel);

  const queue = createAsyncQueue<SyncEvent>();
  const subscriber = createSubscriber();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let messagesReceived = 0;

  const listener = (message: string) => {
    try {
      const parsed = syncEventSchema.safeParse(JSON.parse(message));
      if (!parsed.success) {
        return;
      }
      messagesReceived += 1;
      connectionSpan.addEvent("sync.message_received", {
        eventType: parsed.data.type,
        messageNumber: messagesReceived,
      });
      queue.push(parsed.data);
    } catch (error) {
      connectionSpan.recordException(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  // The connection carries only this channel. If it drops, end the stream so
  // the client reconnects and catches up instead of missing events.
  subscriber.on("message", (_channel: string, message: string) =>
    listener(message)
  );
  subscriber.on("close", queue.close);
  if (signal?.aborted) {
    queue.close();
  }
  signal?.addEventListener("abort", queue.close, { once: true });

  try {
    await subscriber.subscribe(channel);
    connectionSpan.addEvent("sync.subscribed");

    keepaliveTimer = setInterval(() => {
      queue.push({ payload: {}, type: "keepalive" });
    }, KEEPALIVE_INTERVAL_MS);

    reconnectTimer = setTimeout(() => {
      queue.push({
        payload: {},
        type: "reconnect",
      });
      queue.close();
    }, RECONNECT_EVENT_AFTER_MS);

    while (true) {
      // Events must be yielded in order, one at a time.
      // biome-ignore lint/performance/noAwaitInLoops: sequential async iterator
      const next = await queue.next();
      if (next.done) {
        return;
      }

      yield next.value;

      if (next.value.type === "reconnect") {
        connectionSpan.addEvent("sync.reconnect_triggered");
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", queue.close);
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    queue.close();

    // Record total messages on the span before ending
    connectionSpan.setAttribute("messagesReceived", messagesReceived);

    // Closing the connection drops its subscription.
    subscriber.disconnect();
    connectionSpan.end();
  }
}
