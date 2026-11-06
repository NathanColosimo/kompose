import { describe, expect, test } from "bun:test";
import type { SyncEvent } from "@kompose/api/realtime/events";
import { RealtimeSyncSupervisor } from "./realtime-sync-supervisor";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class Clock {
  now = 0;
  private readonly timers = new Set<{
    at: number;
    callback: () => void;
  }>();

  schedule = (callback: () => void, delay: number) => {
    const timer = { at: this.now + delay, callback };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  };

  async advance(ms: number) {
    const until = this.now + ms;
    while (true) {
      const timer = [...this.timers]
        .filter((entry) => entry.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!timer) {
        break;
      }
      this.now = timer.at;
      this.timers.delete(timer);
      timer.callback();
      // biome-ignore lint/performance/noAwaitInLoops: flush work at each controlled deadline
      await flush();
    }
    this.now = until;
    await flush();
  }
}

// return() deliberately leaves next() pending: an old transport can settle late.
class ControlledIterator implements AsyncIterator<SyncEvent> {
  closes = 0;
  private pending = Promise.withResolvers<IteratorResult<SyncEvent>>();

  next() {
    return this.pending.promise;
  }

  return() {
    this.closes += 1;
    return Promise.resolve({ done: true, value: undefined } as const);
  }

  send(event: SyncEvent) {
    const pending = this.pending;
    this.pending = Promise.withResolvers<IteratorResult<SyncEvent>>();
    pending.resolve({ done: false, value: event });
  }

  end() {
    this.pending.resolve({ done: true, value: undefined });
  }

  fail() {
    this.pending.reject(new Error("transport failed"));
  }
}

function setup() {
  const clock = new Clock();
  const streams: ControlledIterator[] = [];
  const signals: AbortSignal[] = [];
  const events: SyncEvent[] = [];
  let recoveries = 0;
  const supervisor = new RealtimeSyncSupervisor({
    connect: (signal) => {
      signals.push(signal);
      const iterator = new ControlledIterator();
      streams.push(iterator);
      return Promise.resolve(iterator);
    },
    now: () => clock.now,
    onEvent: (event) => events.push(event),
    onResubscribe: () => {
      recoveries += 1;
    },
    schedule: clock.schedule,
  });
  return {
    clock,
    events,
    recoveries: () => recoveries,
    signals,
    streams,
    supervisor,
  };
}

function latest(streams: ControlledIterator[]) {
  const stream = streams.at(-1);
  if (!stream) {
    throw new Error("Expected a connected stream");
  }
  return stream;
}

describe("realtime supervisor", () => {
  test("old cleanup and late messages cannot close or affect the resumed stream", async () => {
    const { supervisor, streams, signals, events, clock, recoveries } = setup();
    supervisor.start(true);
    await flush();
    const old = latest(streams);
    expect(recoveries()).toBe(0);
    supervisor.setForeground(false);
    await clock.advance(29_999);
    old.send({ payload: {}, type: "keepalive" });
    await flush();
    supervisor.setForeground(false);
    expect(old.closes).toBe(0);
    await clock.advance(1);
    expect(old.closes).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(supervisor.phase).toBe("paused");
    supervisor.setForeground(true);
    await flush();
    const current = latest(streams);
    expect(recoveries()).toBe(1);
    old.send({ payload: {}, type: "tasks" });
    await flush();
    expect(current.closes).toBe(0);
    expect(supervisor.phase).toBe("consuming");
    expect(events.map((event) => event.type)).toEqual(["keepalive"]);
    supervisor.stop();
    await flush();
    expect(current.closes).toBe(1);
  });

  test("consumption failures and short keepalive streams exhaust ten retries", async () => {
    const { supervisor, streams, clock } = setup();
    supervisor.start(true);
    await flush();
    for (let failure = 0; failure <= 10; failure += 1) {
      const stream = latest(streams);
      stream.send({ payload: {}, type: "keepalive" });
      // biome-ignore lint/performance/noAwaitInLoops: exercise sequential attempts
      await flush();
      stream.fail();
      await flush();
      expect(stream.closes).toBe(1);
      await clock.advance(Math.min(1000 * 2 ** failure, 30_000));
    }
    expect(streams).toHaveLength(11);
    expect(supervisor.phase).toBe("exhausted");
    await clock.advance(120_000);
    expect(streams).toHaveLength(11);
    supervisor.stop();
  });

  test("a real invalidation resets retry backoff after successful consumption", async () => {
    const { supervisor, streams, clock } = setup();
    supervisor.start(true);
    await flush();
    latest(streams).fail();
    await flush();
    await clock.advance(1000);
    latest(streams).send({ payload: {}, type: "tasks" });
    await flush();
    latest(streams).fail();
    await flush();
    await clock.advance(999);
    expect(streams).toHaveLength(2);
    await clock.advance(1);
    expect(streams).toHaveLength(3);
    supervisor.stop();
  });

  test("keepalives prove health only after thirty seconds", async () => {
    const { supervisor, streams, clock } = setup();
    supervisor.start(true);
    await flush();
    latest(streams).fail();
    await flush();
    await clock.advance(1000);
    for (let tick = 0; tick < 3; tick += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: simulate server keepalive cadence
      await clock.advance(10_000);
      latest(streams).send({ payload: {}, type: "keepalive" });
      await flush();
    }
    latest(streams).fail();
    await flush();
    await clock.advance(1000);
    expect(streams).toHaveLength(3);
    supervisor.stop();
  });

  test("EOF, errors, rotation and inactivity all catch up only after resubscription", async () => {
    const { supervisor, streams, clock, recoveries } = setup();
    supervisor.start(true);
    await flush();
    expect(recoveries()).toBe(0);
    latest(streams).end();
    await flush();
    expect(recoveries()).toBe(0);
    await clock.advance(1000);
    expect(recoveries()).toBe(1);
    latest(streams).fail();
    await flush();
    await clock.advance(2000);
    expect(recoveries()).toBe(2);
    latest(streams).send({ payload: {}, type: "reconnect" });
    await flush();
    await clock.advance(0);
    expect(recoveries()).toBe(3);
    const silent = latest(streams);
    await clock.advance(30_000);
    expect(silent.closes).toBe(1);
    await clock.advance(8000);
    expect(recoveries()).toBe(4);
    supervisor.stop();
  });

  test("pending acquisition is aborted and its late iterator closes only itself", async () => {
    const clock = new Clock();
    const pending = Promise.withResolvers<AsyncIterator<SyncEvent>>();
    const old = new ControlledIterator();
    const current = new ControlledIterator();
    const signals: AbortSignal[] = [];
    const supervisor = new RealtimeSyncSupervisor({
      connect: (signal) => {
        signals.push(signal);
        return signals.length === 1
          ? pending.promise
          : Promise.resolve(current);
      },
      onEvent: () => undefined,
      onResubscribe: () => undefined,
      schedule: clock.schedule,
    });
    supervisor.start(true);
    supervisor.setForeground(false);
    await clock.advance(30_000);
    expect(signals[0]?.aborted).toBe(true);
    supervisor.setForeground(true);
    await flush();
    pending.resolve(old);
    await flush();
    expect(old.closes).toBe(1);
    expect(current.closes).toBe(0);
    expect(supervisor.phase).toBe("consuming");
    supervisor.stop();
  });

  test("a pending retry cannot open a new stream while backgrounded", async () => {
    const { supervisor, streams, clock, recoveries } = setup();
    supervisor.start(true);
    await flush();
    latest(streams).fail();
    await flush();
    supervisor.setForeground(false);
    await clock.advance(1000);
    expect(streams).toHaveLength(1);
    supervisor.setForeground(true);
    await flush();
    expect(streams).toHaveLength(2);
    expect(recoveries()).toBe(1);
    supervisor.stop();
  });

  test("initial background stays quiet and a short blur preserves the connection", async () => {
    const { supervisor, streams, clock, recoveries } = setup();
    supervisor.start(false);
    await clock.advance(60_000);
    expect(streams).toHaveLength(0);
    supervisor.setForeground(true);
    await flush();
    expect(recoveries()).toBe(0);
    supervisor.setForeground(false);
    await clock.advance(10_000);
    supervisor.setForeground(true);
    latest(streams).send({ payload: {}, type: "keepalive" });
    await flush();
    await clock.advance(20_000);
    expect(streams).toHaveLength(1);
    expect(latest(streams).closes).toBe(0);
    supervisor.stop();
  });
});
