import { trace } from "@opentelemetry/api";
import { AsyncIteratorClass } from "@orpc/server";
import { type SyncEvent, syncEventSchema } from "./events";

const RECONNECT_EVENT_AFTER_MS = 11 * 60 * 1000;
const KEEPALIVE_INTERVAL_MS = 10_000;
const MAX_PENDING_RESOURCES = 256;
const tracer = trace.getTracer("sync");

type SubscriptionListener = ((
  event: "message",
  listener: (channel: string, message: string) => void
) => unknown) &
  ((event: "close", listener: () => void) => unknown);

interface Subscriber {
  disconnect: () => void;
  off: SubscriptionListener;
  on: SubscriptionListener;
  subscribe: (channel: string) => Promise<unknown>;
}

/** Invalidation events describe resources, so duplicates need only one slot. */
function createEventQueue() {
  const pending = new Map<string, SyncEvent>();
  let closed = false;
  let waiter: ((result: IteratorResult<SyncEvent>) => void) | undefined;

  const push = (event: SyncEvent) => {
    if (closed) {
      return;
    }
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ done: false, value: event });
      return;
    }
    const key =
      event.type === "google-calendar"
        ? JSON.stringify([event.payload.accountId, event.payload.calendarId])
        : event.type;
    if (!pending.has(key) && pending.size >= MAX_PENDING_RESOURCES) {
      reconnect();
      return;
    }
    pending.set(key, event);
  };

  const close = () => {
    closed = true;
    pending.clear();
    waiter?.({ done: true, value: undefined });
    waiter = undefined;
  };

  const reconnect = () => {
    if (closed) {
      return;
    }
    pending.clear();
    push({ payload: {}, type: "reconnect" });
    closed = true;
  };

  return {
    close,
    async next(): Promise<IteratorResult<SyncEvent>> {
      const first = pending.entries().next();
      if (!first.done) {
        const [key, value] = first.value;
        pending.delete(key);
        return { done: false, value };
      }
      if (closed) {
        return { done: true, value: undefined };
      }
      return await new Promise((resolve) => {
        waiter = resolve;
      });
    },
    push,
    reconnect,
  };
}

export async function createSyncEventStream({
  channel,
  createSubscriber,
  signal,
  userId,
}: {
  channel: string;
  createSubscriber: () => Subscriber;
  signal?: AbortSignal;
  userId: string;
}): Promise<AsyncGenerator<SyncEvent, void, unknown>> {
  signal?.throwIfAborted();
  const span = tracer.startSpan("sync.connection");
  span.setAttribute("userId", userId);
  span.setAttribute("channel", channel);
  const queue = createEventQueue();
  const ended = Promise.withResolvers<false>();
  let subscriber: Subscriber | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let messagesReceived = 0;

  const onMessage = (_channel: string, message: string) => {
    try {
      const parsed = syncEventSchema.safeParse(JSON.parse(message));
      if (!parsed.success) {
        return;
      }
      messagesReceived += 1;
      span.addEvent("sync.message_received", {
        eventType: parsed.data.type,
        messageNumber: messagesReceived,
      });
      queue.push(parsed.data);
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    ended.resolve(false);
    queue.close();
    signal?.removeEventListener("abort", dispose);
    clearInterval(keepaliveTimer);
    clearTimeout(reconnectTimer);
    subscriber?.off("message", onMessage);
    subscriber?.off("close", dispose);
    // Also cancels a Redis subscribe command that has not settled.
    subscriber?.disconnect();
    span.setAttribute("messagesReceived", messagesReceived);
    span.end();
  };

  const stream = new AsyncIteratorClass<SyncEvent, void>(
    async () => {
      const next = await queue.next();
      if (!next.done && next.value.type === "reconnect") {
        span.addEvent("sync.reconnect_triggered");
        dispose();
      }
      return next;
    },
    () => Promise.resolve(dispose())
  );

  try {
    subscriber = createSubscriber();
    subscriber.on("message", onMessage);
    subscriber.on("close", dispose);
    signal?.addEventListener("abort", dispose, { once: true });
    signal?.throwIfAborted();
    // A disconnect must settle acquisition even if the Redis command never does.
    const subscribed = await Promise.race([
      subscriber.subscribe(channel).then(() => true),
      ended.promise,
    ]);
    if (!subscribed || disposed) {
      signal?.throwIfAborted();
      throw new Error("Redis subscription closed before acquisition");
    }
    span.addEvent("sync.subscribed");
    keepaliveTimer = setInterval(() => {
      queue.push({ payload: {}, type: "keepalive" });
    }, KEEPALIVE_INTERVAL_MS);
    reconnectTimer = setTimeout(queue.reconnect, RECONNECT_EVENT_AFTER_MS);

    // oRPC can send headers and its initial SSE comment as soon as it gets an
    // iterator, so acquisition must finish before returning it to the handler.
    return stream;
  } catch (error) {
    dispose();
    throw error;
  }
}
