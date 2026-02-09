import { env } from "@kompose/env";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { RedisClient } from "bun";
import { type SyncEvent, syncEventSchema } from "./events";

const USER_CHANNEL_PREFIX = "user";
const RECONNECT_EVENT_AFTER_MS = 11 * 60 * 1000;

const tracer = trace.getTracer("sync");

interface AsyncQueue<T> {
  close: () => void;
  next: () => Promise<IteratorResult<T>>;
  push: (value: T) => void;
}

const redisPublisher = new RedisClient(env.REDIS_URL);

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
 * Publish a sync event to a user's Redis channel.
 * Creates an OTel span for each publish, inheriting the caller's trace context.
 */
export async function publishToUser(
  userId: string,
  event: SyncEvent
): Promise<void> {
  const span = tracer.startSpan("sync.publish");
  span.setAttribute("userId", userId);
  span.setAttribute("eventType", event.type);

  try {
    const payload = syncEventSchema.parse(event);
    await redisPublisher.publish(
      getUserSyncChannel(userId),
      JSON.stringify(payload)
    );
  } catch (error) {
    span.recordException(
      error instanceof Error ? error : new Error(String(error))
    );
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Fire-and-forget publish. Errors are recorded on the OTel span
 * created by publishToUser rather than logged to console.
 */
export function publishToUserBestEffort(
  userId: string,
  event: SyncEvent
): void {
  publishToUser(userId, event).catch(() => {
    // Error already recorded on the sync.publish span
  });
}

/**
 * Long-lived async generator for SSE connections.
 * Creates an OTel span for the connection lifetime, with span events
 * for each message received and exceptions for parse failures.
 */
export async function* createUserSyncEventIterator(
  userId: string
): AsyncGenerator<SyncEvent, void, unknown> {
  const channel = getUserSyncChannel(userId);
  const connectionSpan = tracer.startSpan("sync.connection");
  connectionSpan.setAttribute("userId", userId);
  connectionSpan.setAttribute("channel", channel);

  const queue = createAsyncQueue<SyncEvent>();
  const subscriber = await redisPublisher.duplicate();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let queueClosed = false;
  let messagesReceived = 0;

  const closeQueue = () => {
    if (queueClosed) {
      return;
    }
    queueClosed = true;
    queue.close();
  };

  const listener = (message: string) => {
    try {
      const parsed = syncEventSchema.safeParse(JSON.parse(message));
      if (!parsed.success) {
        return;
      }
      messagesReceived++;
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

  subscriber.onclose = () => {
    closeQueue();
  };

  try {
    await subscriber.subscribe(channel, listener);
    connectionSpan.addEvent("sync.subscribed");

    reconnectTimer = setTimeout(() => {
      queue.push({
        type: "reconnect",
        payload: {},
      });
      closeQueue();
    }, RECONNECT_EVENT_AFTER_MS);

    while (true) {
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
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    closeQueue();

    // Record total messages on the span before ending
    connectionSpan.setAttribute("messagesReceived", messagesReceived);

    try {
      await subscriber.unsubscribe(channel, listener);
    } catch {
      try {
        await subscriber.unsubscribe(channel);
      } catch {
        // no-op
      }
    }
    subscriber.close();
    connectionSpan.end();
  }
}
