import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { syncContract } from "../routers/sync/contract";
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

function setup(
  subscription = Promise.resolve<unknown>(undefined),
  controller = new AbortController()
) {
  const subscriber = new FakeSubscriber();
  subscriber.subscription = subscription;
  const stream = createSyncEventStream({
    channel: "user:test",
    createSubscriber: () => subscriber,
    signal: controller.signal,
    userId: "test",
  });
  return { controller, stream, subscriber };
}

describe("Redis SSE stream", () => {
  test("oRPC waits for Redis acquisition before returning SSE headers or recovery readiness", async () => {
    const pending = Promise.withResolvers<unknown>();
    const { stream, subscriber, controller } = setup(pending.promise);
    const os = implement(syncContract);
    const handler = new RPCHandler({
      events: os.events.handler(() => stream),
    });
    let responseReceived = false;
    const response = handler
      .handle(
        new Request("https://sync-test.example.com/events", { method: "POST" })
      )
      .then((result) => {
        expect(result.response?.status).toBe(200);
        expect(result.response?.headers.get("content-type")).toContain(
          "text/event-stream"
        );
        responseReceived = true;
        return result.response;
      });
    try {
      await flush();
      expect(responseReceived).toBe(false);
      expect(subscriber.subscribes).toBe(1);
      pending.resolve(undefined);
      const result = await response;
      if (!result?.body) {
        throw new Error("Expected an SSE response body");
      }
      const reader = result.body.getReader();
      const comment = await reader.read();
      expect(new TextDecoder().decode(comment.value).startsWith(":")).toBe(
        true
      );
      subscriber.send({ payload: {}, type: "tasks" });
      const event = await reader.read();
      expect(new TextDecoder().decode(event.value)).toContain('"tasks"');
      await reader.cancel();
    } finally {
      pending.resolve(undefined);
      controller.abort();
      await response;
    }
  });

  test("abort settles a pending subscribe and disconnects immediately", async () => {
    const pending = Promise.withResolvers<unknown>();
    const { stream, subscriber, controller } = setup(pending.promise);
    controller.abort();
    expect(subscriber.disconnects).toBeGreaterThan(0);
    await expect(stream).rejects.toMatchObject({ name: "AbortError" });
    pending.reject(new Error("late subscribe rejection"));
    await flush();
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
  });

  test("Redis close settles pending acquisition without waiting for subscribe", async () => {
    const { stream, subscriber } = setup(new Promise(() => undefined));
    subscriber.emit("close");
    await expect(stream).rejects.toThrow(
      "Redis subscription closed before acquisition"
    );
    expect(subscriber.disconnects).toBe(1);
  });

  test("subscription failure releases its connection and listeners", async () => {
    const { stream, subscriber } = setup(
      Promise.reject(new Error("subscribe failed"))
    );
    await expect(stream).rejects.toThrow("subscribe failed");
    expect(subscriber.disconnects).toBe(1);
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
  });

  test("return releases an acquired subscription before the first read", async () => {
    const { stream: acquisition, subscriber } = setup();
    const stream = await acquisition;
    await stream.return();
    expect(subscriber.disconnects).toBe(1);
    expect(subscriber.listenerCount("message")).toBe(0);
    expect(subscriber.listenerCount("close")).toBe(0);
  });

  test("Redis close ends a consuming stream so the client can resubscribe", async () => {
    const { stream: acquisition, subscriber } = setup();
    const stream = await acquisition;
    const next = stream.next();
    await flush();
    subscriber.emit("close");
    expect((await next).done).toBe(true);
    expect(subscriber.disconnects).toBe(1);
  });

  test("coalesces duplicates while retaining distinct calendar resources", async () => {
    const { stream: acquisition, subscriber, controller } = setup();
    const stream = await acquisition;
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
    const { stream: acquisition, subscriber } = setup();
    const stream = await acquisition;
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
    const { stream: acquisition, subscriber, controller } = setup();
    const stream = await acquisition;
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
    const controller = new AbortController();
    controller.abort();
    const { stream: acquisition, subscriber } = setup(undefined, controller);
    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
    expect(subscriber.subscribes).toBe(0);
    expect(subscriber.disconnects).toBe(0);
  });
});
