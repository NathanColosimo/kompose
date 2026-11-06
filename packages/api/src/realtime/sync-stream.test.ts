import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SyncEvent } from "./events";
import { createSyncEventStream } from "./sync-stream";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeSubscriber extends EventEmitter {
  disconnects = 0;
  subscription = Promise.resolve<unknown>(undefined);
  subscribes = 0;

  subscribe(_channel: string) {
    this.subscribes += 1;
    return this.subscription;
  }

  disconnect() {
    this.disconnects += 1;
  }

  send(event: SyncEvent) {
    this.emit("message", "user:test", JSON.stringify(event));
  }
}

function setup() {
  const subscriber = new FakeSubscriber();
  const controller = new AbortController();
  const stream = createSyncEventStream({
    channel: "user:test",
    createSubscriber: () => subscriber,
    signal: controller.signal,
    userId: "test",
  });
  return { controller, stream, subscriber };
}

describe("Redis SSE stream", () => {
  test("abort settles a pending subscribe and disconnects immediately", async () => {
    const { stream, subscriber, controller } = setup();
    const pending = Promise.withResolvers<unknown>();
    subscriber.subscription = pending.promise;
    const next = stream.next();
    controller.abort();
    expect(subscriber.disconnects).toBeGreaterThan(0);
    expect((await next).done).toBe(true);
    pending.reject(new Error("late subscribe rejection"));
    await flush();
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
  });

  test("Redis close settles pending acquisition without waiting for subscribe", async () => {
    const { stream, subscriber } = setup();
    subscriber.subscription = new Promise(() => undefined);
    const next = stream.next();
    subscriber.emit("close");
    expect((await next).done).toBe(true);
    expect(subscriber.disconnects).toBe(1);
  });

  test("subscription failure releases its connection and listeners", async () => {
    const { stream, subscriber } = setup();
    subscriber.subscription = Promise.reject(new Error("subscribe failed"));
    await expect(stream.next()).rejects.toThrow("subscribe failed");
    expect(subscriber.disconnects).toBe(1);
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
  });

  test("Redis close ends a consuming stream so the client can resubscribe", async () => {
    const { stream, subscriber } = setup();
    const next = stream.next();
    await flush();
    subscriber.emit("close");
    expect((await next).done).toBe(true);
    expect(subscriber.disconnects).toBe(1);
  });

  test("coalesces duplicates while retaining distinct calendar resources", async () => {
    const { stream, subscriber, controller } = setup();
    const first = stream.next();
    await flush();
    subscriber.send({ payload: {}, type: "tasks" });
    await first;
    for (let i = 0; i < 1000; i += 1) {
      subscriber.send({ payload: {}, type: "tasks" });
      subscriber.send({ payload: {}, type: "keepalive" });
      subscriber.send({
        payload: { accountId: "one", calendarId: "calendar" },
        type: "google-calendar",
      });
    }
    subscriber.send({
      payload: { accountId: "two", calendarId: "calendar" },
      type: "google-calendar",
    });
    const buffered: SyncEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: drain sequential async iterator
      const next = await stream.next();
      if (!next.done) {
        buffered.push(next.value);
      }
    }
    expect(buffered).toEqual([
      { payload: {}, type: "tasks" },
      { payload: {}, type: "keepalive" },
      {
        payload: { accountId: "one", calendarId: "calendar" },
        type: "google-calendar",
      },
      {
        payload: { accountId: "two", calendarId: "calendar" },
        type: "google-calendar",
      },
    ]);
    const waiting = stream.next();
    await flush();
    controller.abort();
    expect((await waiting).done).toBe(true);
  });

  test("bounds distinct queued resources by requesting recovery on overflow", async () => {
    const { stream, subscriber } = setup();
    const first = stream.next();
    await flush();
    subscriber.send({ payload: {}, type: "tasks" });
    await first;
    for (let i = 0; i < 1000; i += 1) {
      subscriber.send({
        payload: { accountId: "one", calendarId: String(i) },
        type: "google-calendar",
      });
    }
    expect(await stream.next()).toEqual({
      done: false,
      value: { payload: {}, type: "reconnect" },
    });
    expect((await stream.next()).done).toBe(true);
    expect(subscriber.disconnects).toBe(1);
  });

  test("abort releases the subscriber even while the consumer is suspended at yield", async () => {
    const { stream, subscriber, controller } = setup();
    const first = stream.next();
    await flush();
    subscriber.send({ payload: {}, type: "tasks" });
    await first;
    controller.abort();
    expect(subscriber.disconnects).toBe(1);
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
    await stream.return();
    expect(subscriber.disconnects).toBe(1);
  });

  test("an already aborted request never acquires a subscriber", async () => {
    const { stream, subscriber, controller } = setup();
    controller.abort();
    expect((await stream.next()).done).toBe(true);
    expect(subscriber.subscribes).toBe(0);
    expect(subscriber.disconnects).toBe(0);
  });
});
