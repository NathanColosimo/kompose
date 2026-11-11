import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AppRouterClient } from "@kompose/api/routers/index";
import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import { createORPCClient } from "@orpc/client";
import { notifyManager, QueryClient } from "@tanstack/query-core";
import type { Account } from "better-auth";
import { type Atom, createStore } from "jotai";
import { queryClientAtom } from "jotai-tanstack-query";
import { Temporal } from "temporal-polyfill";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { stateConfigAtom } from "../config";
import { currentDateAtom, timezoneAtom } from "./current-date";
import {
  shouldShowWhoopRow,
  whoopAccountIdAtom,
  whoopSummariesByDayAtom,
} from "./whoop-data";

function account(accountId: string): Account {
  return {
    accountId,
    createdAt: new Date("2026-01-01"),
    id: `row-${accountId}`,
    providerId: "whoop",
    updatedAt: new Date("2026-01-01"),
    userId: "user",
  };
}

function summary(day: string, recoveryScore = 80): WhoopDaySummary {
  return {
    cycleId: 1,
    day,
    kilojoule: null,
    naps: [],
    recoveryScore,
    sleep: null,
    sleepPerformance: null,
    strainScore: null,
    workouts: [],
  };
}

function waitForAtom<T>(
  store: ReturnType<typeof createStore>,
  target: Atom<T>,
  predicate: (value: T) => boolean
) {
  return new Promise<void>((resolve) => {
    const unsubscribe = store.sub(target, () => {
      if (predicate(store.get(target))) {
        unsubscribe();
        resolve();
      }
    });
    if (predicate(store.get(target))) {
      unsubscribe();
      resolve();
    }
  });
}

function createHarness() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  const requests: {
    input: unknown;
    resolve: (data: WhoopDaySummary[]) => void;
  }[] = [];

  queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("whoop-a")]);
  store.set(queryClientAtom, queryClient);
  store.set(currentDateAtom, Temporal.PlainDate.from("2026-11-06"));
  store.set(timezoneAtom, "America/New_York");
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: () => Promise.resolve(null),
      listAccounts: () =>
        Promise.resolve(
          queryClient.getQueryData<Account[]>(LINKED_ACCOUNTS_QUERY_KEY) ?? []
        ),
      unlinkAccount: () => Promise.resolve(),
    },
    orpc: createORPCClient<AppRouterClient>({
      call: (_path, input) => {
        const { promise, resolve } = Promise.withResolvers<WhoopDaySummary[]>();
        requests.push({ input, resolve });
        return promise;
      },
    }),
  });
  const unsubscribe = store.sub(whoopSummariesByDayAtom, () => undefined);

  return {
    dispose: () => {
      unsubscribe();
      queryClient.clear();
    },
    queryClient,
    request: (index: number) => {
      const request = requests[index];
      if (!request) {
        throw new Error(`WHOOP request ${index} has not started`);
      }
      return request;
    },
    requests,
    store,
  };
}

describe("WHOOP summaries atoms", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  test("clears summaries when the WHOOP account is unlinked", async () => {
    const { queryClient, store } = harness;
    const day = summary("2026-11-06");
    harness.request(0).resolve([day]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(day.day)
    );

    queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, []);
    await waitForAtom(store, whoopAccountIdAtom, (id) => id === null);

    const emptyMap = store.get(whoopSummariesByDayAtom);
    expect(emptyMap.size).toBe(0);
    store.set(currentDateAtom, Temporal.PlainDate.from("2026-12-06"));
    store.set(timezoneAtom, "Asia/Tokyo");
    expect(store.get(whoopSummariesByDayAtom)).toBe(emptyMap);
    expect(harness.requests).toHaveLength(1);
  });

  test("does not use another account's summaries while its request is pending", async () => {
    const { queryClient, store } = harness;
    const previousDay = summary("2026-11-06");
    harness.request(0).resolve([previousDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(previousDay.day)
    );

    queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("whoop-b")]);
    await waitForAtom(store, whoopAccountIdAtom, (id) => id === "whoop-b");

    expect(store.get(whoopSummariesByDayAtom).size).toBe(0);
    expect(harness.request(1).input).toEqual({
      accountId: "whoop-b",
      endDate: "2026-12-07",
      startDate: "2026-10-25",
      timeZone: "America/New_York",
    });

    const nextDay = summary("2026-11-06", 50);
    harness.request(1).resolve([nextDay]);
    await waitForAtom(
      store,
      whoopSummariesByDayAtom,
      (map) => map.get(nextDay.day)?.recoveryScore === 50
    );
    expect(store.get(whoopSummariesByDayAtom).get(nextDay.day)).toEqual(
      nextDay
    );
  });

  test("fetches timezone-specific summaries without showing the previous timezone", async () => {
    const { store } = harness;
    const previousDay = summary("2026-11-06");
    harness.request(0).resolve([previousDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(previousDay.day)
    );

    store.set(timezoneAtom, "Asia/Tokyo");

    expect(store.get(whoopSummariesByDayAtom).size).toBe(0);
    expect(harness.request(1).input).toEqual({
      accountId: "whoop-a",
      endDate: "2026-12-07",
      startDate: "2026-10-25",
      timeZone: "Asia/Tokyo",
    });

    const nextDay = summary("2026-11-07");
    harness.request(1).resolve([nextDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(nextDay.day)
    );
    expect(store.get(whoopSummariesByDayAtom).has(previousDay.day)).toBe(false);

    store.set(timezoneAtom, "America/New_York");
    expect(store.get(whoopSummariesByDayAtom).get(previousDay.day)).toEqual(
      previousDay
    );
    expect(harness.requests).toHaveLength(2);
  });

  test("keeps the same account and timezone's summaries across month transitions", async () => {
    const { store } = harness;
    const novemberDay = summary("2026-11-06");
    harness.request(0).resolve([novemberDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(novemberDay.day)
    );
    const novemberMap = store.get(whoopSummariesByDayAtom);

    store.set(currentDateAtom, Temporal.PlainDate.from("2026-12-06"));
    expect(store.get(whoopSummariesByDayAtom)).toBe(novemberMap);
    expect(harness.request(1).input).toEqual({
      accountId: "whoop-a",
      endDate: "2027-01-07",
      startDate: "2026-11-24",
      timeZone: "America/New_York",
    });

    const decemberDay = summary("2026-12-06");
    harness.request(1).resolve([decemberDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(decemberDay.day)
    );
    expect(store.get(whoopSummariesByDayAtom).has(novemberDay.day)).toBe(false);
  });

  test("drops month placeholder data on account changes and ignores the old response", async () => {
    const { queryClient, store } = harness;
    const previousDay = summary("2026-11-06");
    harness.request(0).resolve([previousDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(previousDay.day)
    );

    store.set(currentDateAtom, Temporal.PlainDate.from("2026-12-06"));
    expect(store.get(whoopSummariesByDayAtom).get(previousDay.day)).toEqual(
      previousDay
    );
    queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("whoop-b")]);
    await waitForAtom(store, whoopAccountIdAtom, (id) => id === "whoop-b");
    expect(store.get(whoopSummariesByDayAtom).size).toBe(0);

    harness.request(1).resolve([summary("2026-12-06")]);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    expect(store.get(whoopSummariesByDayAtom).size).toBe(0);

    const nextDay = summary("2026-12-06", 50);
    harness.request(2).resolve([nextDay]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(nextDay.day)
    );
    expect(store.get(whoopSummariesByDayAtom).get(nextDay.day)).toEqual(
      nextDay
    );
  });

  test("preserves the map during refetches and rebuilds it when summaries change", async () => {
    const { queryClient, store } = harness;
    const day = summary("2026-11-06");
    harness.request(0).resolve([day]);
    await waitForAtom(store, whoopSummariesByDayAtom, (map) =>
      map.has(day.day)
    );
    const previousMap = store.get(whoopSummariesByDayAtom);

    const refetch = queryClient.invalidateQueries({
      queryKey: ["whoop", "days"],
    });
    expect(queryClient.isFetching({ queryKey: ["whoop", "days"] })).toBe(1);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    expect(store.get(whoopSummariesByDayAtom)).toBe(previousMap);

    const updatedDay = summary("2026-11-06", 50);
    harness.request(1).resolve([updatedDay]);
    await refetch;
    await waitForAtom(
      store,
      whoopSummariesByDayAtom,
      (map) => map.get(day.day)?.recoveryScore === 50
    );
    const updatedMap = store.get(whoopSummariesByDayAtom);
    expect(updatedMap).not.toBe(previousMap);
    expect(updatedMap.get(day.day)).toEqual(updatedDay);

    const unchangedRefetch = queryClient.invalidateQueries({
      queryKey: ["whoop", "days"],
    });
    harness.request(2).resolve([{ ...updatedDay }]);
    await unchangedRefetch;
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    expect(store.get(whoopSummariesByDayAtom)).toBe(updatedMap);
  });
});

const rowSummary: WhoopDaySummary = {
  cycleId: 1,
  day: "2026-11-07",
  kilojoule: null,
  naps: [],
  recoveryScore: 72,
  sleep: null,
  sleepPerformance: null,
  strainScore: null,
  workouts: [],
};

describe("shouldShowWhoopRow", () => {
  test("keeps the row while WHOOP is linked, even without data", () => {
    expect(shouldShowWhoopRow("w-1", ["2026-11-08"], new Map())).toBe(true);
  });

  test("shows the row when a visible day has stats", () => {
    const summaries = new Map([[rowSummary.day, rowSummary]]);
    expect(shouldShowWhoopRow(null, ["2026-11-07"], summaries)).toBe(true);
  });

  test("hides the row with no account and no stats", () => {
    expect(shouldShowWhoopRow(null, ["2026-11-07"], new Map())).toBe(false);
  });
});
