import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Option } from "effect";

// An in-memory Redis behind the real cache and realtime code, so the test
// checks what a write leaves cached and who hears about it.
const store = new Map<string, string>();
/** What the realtime code published: a channel and its sync event. */
const published: {
  channel: string;
  message: { payload: { calendarId: string } };
}[] = [];
const fakeRedis = {
  del: (...keys: string[]) =>
    Promise.resolve(keys.filter((key) => store.delete(key)).length),
  get: (key: string) => Promise.resolve(store.get(key) ?? null),
  publish: (channel: string, message: string) => {
    published.push({ channel, message: JSON.parse(message) });
    return Promise.resolve(1);
  },
  scan: (_cursor: string, _match: string, pattern: string) =>
    Promise.resolve([
      "0",
      [...store.keys()].filter((key) => key.startsWith(pattern.slice(0, -1))),
    ]),
  set: (key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve("OK");
  },
};
mock.module("@kompose/redis", () => ({
  createSubscriber: () => fakeRedis,
  redis: fakeRedis,
}));

const { GoogleCalendarCacheService } = await import("./cache");
const { invalidateGoogleCalendarEvents } = await import("./refresh");

const user = "user-1";
const account = "account-1";
const event = (id: string) => ({
  end: { dateTime: "2026-11-16T09:30:00-05:00" },
  id,
  start: { dateTime: "2026-11-16T09:00:00-05:00" },
});
const occurrence = "series_20261116T140000Z";
const range = ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"] as const;

/** Caches each calendar's events and the named events, then reports which are still cached after `write`. */
const cachedAfter = <A, E>(
  write: Effect.Effect<A, E>,
  params: { calendarIds: [string, ...string[]]; recurringEventId?: string }
) =>
  Effect.gen(function* () {
    const cache = yield* GoogleCalendarCacheService;
    for (const calendarId of ["work", "home", "other"]) {
      yield* cache.setCachedEvents(user, account, calendarId, ...range, [
        event(occurrence),
      ]);
    }
    for (const eventId of [occurrence, "series", "unrelated"]) {
      yield* cache.setCachedEvent(
        user,
        account,
        "work",
        eventId,
        event(eventId)
      );
    }

    const exit = yield* Effect.exit(
      write.pipe(
        Effect.ensuring(
          invalidateGoogleCalendarEvents({
            accountId: account,
            eventId: occurrence,
            userId: user,
            ...params,
          })
        )
      )
    );

    const lists: string[] = [];
    for (const calendarId of ["work", "home", "other"]) {
      const list = yield* cache.getCachedEvents(
        user,
        account,
        calendarId,
        ...range
      );
      if (Option.isSome(list)) {
        lists.push(calendarId);
      }
    }
    const events: string[] = [];
    for (const eventId of [occurrence, "series", "unrelated"]) {
      const cached = yield* cache.getCachedEvent(
        user,
        account,
        "work",
        eventId
      );
      if (Option.isSome(cached)) {
        events.push(eventId);
      }
    }
    const told = published.map(({ message }) => message.payload.calendarId);
    return { events, exit, lists, told };
  }).pipe(Effect.provide(GoogleCalendarCacheService.layer), Effect.runPromise);

describe("invalidateGoogleCalendarEvents", () => {
  beforeEach(() => {
    store.clear();
    published.length = 0;
  });

  test("after a write through an occurrence, clears it, its series and the calendar's events, and tells the user", async () => {
    const result = await cachedAfter(Effect.succeed("saved"), {
      calendarIds: ["work"],
      recurringEventId: "series",
    });

    expect(result.exit).toEqual(Exit.succeed("saved"));
    expect(result.events).toEqual(["unrelated"]);
    expect(result.lists).toEqual(["home", "other"]);
    expect(result.told).toEqual(["work"]);
  });

  test("clears the same when the write fails, and keeps its failure", async () => {
    const result = await cachedAfter(Effect.fail("Google refused"), {
      calendarIds: ["work"],
      recurringEventId: "series",
    });

    expect(result.exit).toEqual(Exit.fail("Google refused"));
    expect(result.events).toEqual(["unrelated"]);
    expect(result.lists).toEqual(["home", "other"]);
    expect(result.told).toEqual(["work"]);
  });

  test("a move clears and tells both calendars", async () => {
    const result = await cachedAfter(Effect.succeed("moved"), {
      calendarIds: ["work", "home"],
      recurringEventId: "series",
    });

    expect(result.lists).toEqual(["other"]);
    expect(result.told).toEqual(["work", "home"]);
  });

  test("a write to a single event leaves other events cached", async () => {
    const result = await cachedAfter(Effect.succeed("saved"), {
      calendarIds: ["work"],
    });

    expect(result.events).toEqual(["series", "unrelated"]);
  });
});
