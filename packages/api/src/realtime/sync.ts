import { env } from "@kompose/env";
import { RedisClient } from "bun";
import { type SyncEvent, syncEventSchema } from "./events";

const USER_CHANNEL_PREFIX = "user";
const RECONNECT_EVENT_AFTER_MS = 11 * 60 * 1000;

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

export async function publishToUser(
  userId: string,
  event: SyncEvent
): Promise<void> {
  const payload = syncEventSchema.parse(event);

  await redisPublisher.publish(
    getUserSyncChannel(userId),
    JSON.stringify(payload)
  );
}

export function publishToUserBestEffort(
  userId: string,
  event: SyncEvent
): void {
  publishToUser(userId, event).catch((error) => {
    console.error("Failed to publish realtime event.", {
      error,
      userId,
      type: event.type,
    });
  });
}

export async function* createUserSyncEventIterator(
  userId: string
): AsyncGenerator<SyncEvent, void, unknown> {
  const channel = getUserSyncChannel(userId);
  const queue = createAsyncQueue<SyncEvent>();
  const subscriber = await redisPublisher.duplicate();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let queueClosed = false;

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
      queue.push(parsed.data);
    } catch (error) {
      console.error("Failed to parse realtime Redis message.", {
        channel,
        error,
      });
    }
  };

  subscriber.onclose = () => {
    closeQueue();
  };

  try {
    await subscriber.subscribe(channel, listener);

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
        return;
      }
    }
  } finally {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    closeQueue();
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
  }
}
