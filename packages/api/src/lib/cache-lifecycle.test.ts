import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database as DatabaseService } from "@kompose/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Context as EffectContext } from "effect";
import type { LinkedAccount } from "./linked-account";

// Only external storage and provider calls are faked. Routers, linkage lookup,
// cache services, JSON validation and Effect execution use the real code.
const values = new Map<string, string>();
const ttls = new Map<string, number>();
let generationUnavailable = false;
let cacheReads = 0;
const redisFake = {
  eval() {
    return Promise.resolve([1, 60_000]);
  },
  get(key: string) {
    if (generationUnavailable && key.includes("-generation:")) {
      return Promise.reject(new Error("Redis unavailable"));
    }
    cacheReads += 1;
    return Promise.resolve(values.get(key) ?? null);
  },
  incr(key: string) {
    const next = Number(values.get(key) ?? "0") + 1;
    values.set(key, String(next));
    return Promise.resolve(next);
  },
  publish() {
    return Promise.resolve(0);
  },
  set(key: string, value: string, _mode: string, ttl: number) {
    values.set(key, value);
    ttls.set(key, ttl);
    return Promise.resolve("OK");
  },
};
mock.module("@kompose/redis", () => ({
  createSubscriber: () => {
    throw new Error("Unexpected subscription");
  },
  redis: redisFake,
}));

let tokenCalls = 0;
mock.module("@kompose/auth", () => ({
  auth: {
    api: {
      getAccessToken() {
        tokenCalls += 1;
        return Promise.resolve({ accessToken: "test-token" });
      },
    },
  },
}));

const oldEvent = {
  end: { date: "2026-11-07" },
  id: "series-instance",
  start: { date: "2026-11-06" },
  summary: "old",
};
let googleReads = 0;
let fetchEvents = async () => [oldEvent];
let fetchEvent = async () => oldEvent;
const googleFake = {
  createEvent: () => Effect.succeed(oldEvent),
  deleteEvent: () => Effect.void,
  getEvent: () =>
    Effect.promise(() => {
      googleReads += 1;
      return fetchEvent();
    }),
  listCalendars: () =>
    Effect.sync(() => {
      googleReads += 1;
      return [{ id: "cal", summary: "Calendar" }];
    }),
  getCalendar: () =>
    Effect.sync(() => {
      googleReads += 1;
      return { id: "cal", summary: "Calendar" };
    }),
  listColors: () =>
    Effect.sync(() => {
      googleReads += 1;
      return { event: {} };
    }),
  listEvents: () =>
    Effect.promise(() => {
      googleReads += 1;
      return fetchEvents();
    }),
  moveEvent: () => Effect.succeed(oldEvent),
  updateEvent: () => Effect.succeed(oldEvent),
};
mock.module("@kompose/google-cal/client", () => ({
  makeGoogleCalendarService: () => googleFake,
}));
let whoopFetches = 0;
mock.module("@kompose/whoop/client", () => ({
  createWhoopClient: () => {
    whoopFetches += 1;
    return {
      listCycles: () => Effect.succeed([]),
      listRecoveries: () => Effect.succeed([]),
      listSleeps: () => Effect.succeed([]),
      listWorkouts: () => Effect.succeed([]),
    };
  },
}));

const { Database } = await import("@kompose/db");
const { call } = await import("@orpc/server");
const { GoogleCalendarCacheService } = await import(
  "../routers/google-cal/cache"
);
const { googleCalRouter } = await import("../routers/google-cal/router");
const { WhoopCacheService } = await import("../routers/whoop/cache");
const { WhoopService } = await import("../routers/whoop/service");

const googleLink: LinkedAccount = {
  accountId: "provider",
  id: "link-1",
  providerId: "google",
  userId: "user",
};
const whoopLink: LinkedAccount = {
  ...googleLink,
  id: "whoop-link-1",
  providerId: "whoop",
};
let links: LinkedAccount[] = [];
const dialect = new PgDialect();
// The fake implements only the Drizzle select chain exercised by linkage lookup;
// the real Database service also exposes unrelated queries and transactions.
const database = {
  select: () => ({
    from: () => ({
      where: (where: SQL) => ({
        limit: (limit: number) =>
          Effect.sync(() => {
            const [accountId, providerId, userId] =
              dialect.sqlToQuery(where).params;
            return links
              .filter(
                (link) =>
                  link.accountId === accountId &&
                  link.providerId === providerId &&
                  link.userId === userId
              )
              .slice(0, limit)
              .map(({ id }) => ({ id }));
          }),
      }),
    }),
  }),
} as unknown as EffectContext.Service.Shape<typeof Database>;
const cache = Effect.runSync(GoogleCalendarCacheService.make);
const whoopCache = Effect.runSync(WhoopCacheService.make);
const services = EffectContext.make(Database, database).pipe(
  EffectContext.add(GoogleCalendarCacheService, cache),
  EffectContext.add(WhoopCacheService, whoopCache)
);
// oRPC's shared Context names every API service. These procedures only consume
// Database and GoogleCalendarCacheService, supplied by the test context.
const context = {
  "effect/context": services,
  user: {
    createdAt: new Date(),
    email: "user@example.com",
    emailVerified: true,
    id: "user",
    name: "User",
    updatedAt: new Date(),
  },
} as import("../context").Context;
const eventInput = {
  accountId: "provider",
  calendarId: "cal",
  eventId: "series-instance",
};
const listInput = {
  accountId: "provider",
  calendarId: "cal",
  params: { timeMax: "2026-11-07T00:00:00Z", timeMin: "2026-11-06T00:00:00Z" },
};
const listEvents = () =>
  call(googleCalRouter.events.list, listInput, { context });
const getEvent = () =>
  call(googleCalRouter.events.get, eventInput, { context });
const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
  Effect.runPromise(effect.pipe(Effect.provideContext(services)));
const listWhoop = (day = "2026-11-06") =>
  run(
    Effect.gen(function* () {
      const service = yield* WhoopService.make;
      return yield* service.listDaySummaries({
        accountId: "provider",
        endDate: day,
        startDate: day,
        timeZone: "UTC",
        userId: "user",
      });
    }).pipe(Effect.provideService(WhoopCacheService, whoopCache))
  );

beforeEach(() => {
  values.clear();
  ttls.clear();
  links = [googleLink, whoopLink];
  cacheReads = 0;
  tokenCalls = 0;
  googleReads = 0;
  whoopFetches = 0;
  generationUnavailable = false;
  fetchEvents = async () => [oldEvent];
  fetchEvent = async () => oldEvent;
});

describe("calendar generation invalidation", () => {
  for (const resource of ["list", "single"] as const) {
    test(`a late ${resource} fetch cannot populate the new generation`, async () => {
      const started = Promise.withResolvers<void>();
      const response = Promise.withResolvers<typeof oldEvent>();
      const fetchOld = () => {
        started.resolve();
        return response.promise;
      };
      if (resource === "list") {
        fetchEvents = async () => [await fetchOld()];
      } else {
        fetchEvent = fetchOld;
      }
      const read = resource === "list" ? listEvents : getEvent;
      const pending = read();
      await started.promise;
      await call(
        googleCalRouter.events.create,
        { accountId: "provider", calendarId: "cal", event: oldEvent },
        { context }
      );
      response.resolve(oldEvent);
      await pending;
      const fresh = { ...oldEvent, summary: "fresh" };
      fetchEvents = async () => [fresh];
      fetchEvent = async () => fresh;
      expect(await read()).toEqual(resource === "list" ? [fresh] : fresh);
      expect(googleReads).toBe(2);
      await read();
      expect(googleReads).toBe(2);
      expect([...ttls.values()]).toEqual([86_400, 86_400]);
    });
  }

  test("a recurring update invalidates lists and other single-event instances", async () => {
    await listEvents();
    await getEvent();
    await call(
      googleCalRouter.events.update,
      {
        ...eventInput,
        eventId: "series",
        event: { ...oldEvent, summary: "updated" },
        scope: "all",
      },
      { context }
    );
    googleReads = 0;
    await listEvents();
    await getEvent();
    expect(googleReads).toBe(2);
  });

  test("generation lookup failure bypasses cached data and cannot write into generation zero", async () => {
    await listEvents();
    generationUnavailable = true;
    fetchEvents = async () => [{ ...oldEvent, summary: "uncached" }];
    expect(await listEvents()).toEqual([{ ...oldEvent, summary: "uncached" }]);
    generationUnavailable = false;
    expect(await listEvents()).toEqual([oldEvent]);
    expect(googleReads).toBe(2);
  });
});

describe("linkage lifecycle", () => {
  const googleReadsToTest = [
    ["event list", listEvents],
    ["single event", getEvent],
    [
      "calendars",
      () =>
        call(
          googleCalRouter.calendars.list,
          { accountId: "provider" },
          { context }
        ),
    ],
    [
      "single calendar",
      () =>
        call(
          googleCalRouter.calendars.get,
          { accountId: "provider", calendarId: "cal" },
          { context }
        ),
    ],
    [
      "colors",
      () =>
        call(
          googleCalRouter.colors.list,
          { accountId: "provider" },
          { context }
        ),
    ],
  ] as const;
  for (const [resource, read] of googleReadsToTest) {
    test(`Google ${resource}: unlink blocks cache hits and relink starts a new namespace`, async () => {
      const original = await read();
      expect(await read()).toEqual(original);
      expect(googleReads).toBe(1);
      expect(tokenCalls).toBe(1);
      const storedKeys = new Set(values.keys());
      links = [whoopLink];
      cacheReads = 0;
      await expect(read()).rejects.toMatchObject({
        _tag: "LinkedAccountError",
      });
      expect(cacheReads).toBe(0);
      links.push({ ...googleLink, id: "link-2" });
      await read();
      expect(googleReads).toBe(2);
      expect([...values.keys()].some((key) => !storedKeys.has(key))).toBe(true);
    });
  }

  test("WHOOP: unlink blocks cached days and relink cannot reuse them", async () => {
    const original = await listWhoop();
    expect(await listWhoop()).toEqual(original);
    expect(whoopFetches).toBe(1);
    expect(tokenCalls).toBe(1);
    links = [googleLink];
    cacheReads = 0;
    await expect(listWhoop()).rejects.toMatchObject({
      _tag: "LinkedAccountError",
    });
    expect(cacheReads).toBe(0);
    links.push({ ...whoopLink, id: "whoop-link-2" });
    await listWhoop();
    expect(whoopFetches).toBe(2);
    expect([...ttls.values()]).toEqual([900, 900]);
  });

  test("WHOOP future days skip cache access and provider requests", async () => {
    expect(await listWhoop("9999-12-30")).toEqual([]);
    expect(cacheReads).toBe(0);
    expect(tokenCalls).toBe(0);
    expect(whoopFetches).toBe(0);
  });
});
