import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DayData } from "@kompose/api/routers/days/contract";
import type { AppRouterClient } from "@kompose/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { QueryClient } from "@tanstack/query-core";
import type { Account } from "better-auth";
import { type Atom, createStore } from "jotai";
import { queryClientAtom } from "jotai-tanstack-query";
import { Temporal } from "temporal-polyfill";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { stateConfigAtom } from "../config";
import { currentDateAtom } from "./current-date";
import {
  dayMetricsByDayAtom,
  hasDayDataAtom,
  shouldShowDayStatsRow,
  workoutsAtom,
} from "./day-data";

function account(accountId: string, providerId = "whoop"): Account {
  return {
    accountId,
    createdAt: new Date("2026-01-01"),
    id: `row-${accountId}`,
    providerId,
    updatedAt: new Date("2026-01-01"),
    userId: "user",
  };
}

function dayData(date: string, recovery = 80): DayData {
  return {
    activities: [
      {
        date,
        details: { strain: 8.2 },
        endAt: `${date}T18:00:00.000Z`,
        id: crypto.randomUUID(),
        kind: "workout",
        pluginId: "whoop",
        startAt: `${date}T17:00:00.000Z`,
        title: "running",
      },
    ],
    metrics: [
      { date, metric: "recovery_score", pluginId: "whoop", value: recovery },
    ],
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
  const requests: { input: unknown; resolve: (data: DayData) => void }[] = [];

  queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("whoop-a")]);
  store.set(queryClientAtom, queryClient);
  store.set(currentDateAtom, Temporal.PlainDate.from("2026-11-06"));
  store.set(stateConfigAtom, {
    authClient: {
      listAccounts: () =>
        Promise.resolve(
          queryClient.getQueryData<Account[]>(LINKED_ACCOUNTS_QUERY_KEY) ?? []
        ),
      unlinkAccount: () => Promise.resolve(),
    },
    orpc: createORPCClient<AppRouterClient>({
      call: (_path, input) => {
        const { promise, resolve } = Promise.withResolvers<DayData>();
        requests.push({ input, resolve });
        return promise;
      },
    }),
  });
  const unsubscribe = store.sub(dayMetricsByDayAtom, () => undefined);

  return {
    dispose: () => {
      unsubscribe();
      queryClient.clear();
    },
    queryClient,
    request: (index: number) => {
      const request = requests[index];
      if (!request) {
        throw new Error(`Day data request ${index} has not started`);
      }
      return request;
    },
    requests,
    store,
  };
}

describe("day data atoms", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  test("shows a day's numbers and workouts, and clears them when the plugin is unlinked", async () => {
    const { queryClient, store } = harness;
    expect(harness.request(0).input).toEqual({
      endDate: "2026-12-07",
      startDate: "2026-10-25",
    });
    harness.request(0).resolve(dayData("2026-11-06"));
    await waitForAtom(store, dayMetricsByDayAtom, (map) =>
      map.has("2026-11-06")
    );
    expect(store.get(dayMetricsByDayAtom).get("2026-11-06")).toEqual({
      recovery_score: 80,
    });
    expect(store.get(workoutsAtom)).toHaveLength(1);

    // A Google account records no day data.
    queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [
      account("google-a", "google"),
    ]);
    await waitForAtom(store, hasDayDataAtom, (linked) => !linked);
    expect(store.get(dayMetricsByDayAtom).size).toBe(0);
    expect(store.get(workoutsAtom)).toEqual([]);
    expect(harness.requests).toHaveLength(1);
  });

  test("keeps the last month on screen while the next loads, but never another account's", async () => {
    const { queryClient, store } = harness;
    harness.request(0).resolve(dayData("2026-11-06"));
    await waitForAtom(store, dayMetricsByDayAtom, (map) =>
      map.has("2026-11-06")
    );

    store.set(currentDateAtom, Temporal.PlainDate.from("2026-12-06"));
    await waitForAtom(
      store,
      dayMetricsByDayAtom,
      () => harness.requests.length === 2
    );
    expect(store.get(dayMetricsByDayAtom).has("2026-11-06")).toBe(true);
    harness.request(1).resolve(dayData("2026-12-06"));
    await waitForAtom(store, dayMetricsByDayAtom, (map) =>
      map.has("2026-12-06")
    );

    queryClient.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("whoop-b")]);
    await waitForAtom(store, dayMetricsByDayAtom, (map) => map.size === 0);
    harness.request(2).resolve(dayData("2026-12-06", 55));
    await waitForAtom(store, dayMetricsByDayAtom, (map) => map.size === 1);
    expect(store.get(dayMetricsByDayAtom).get("2026-12-06")).toEqual({
      recovery_score: 55,
    });
  });
});

describe("shouldShowDayStatsRow", () => {
  test("keeps the row while a plugin is linked or a visible day has stats", () => {
    const stats = new Map([["2026-11-06", { recovery_score: 80 }]]);
    expect(shouldShowDayStatsRow(true, ["2026-11-07"], new Map())).toBe(true);
    expect(shouldShowDayStatsRow(false, ["2026-11-06"], stats)).toBe(true);
    expect(shouldShowDayStatsRow(false, ["2026-11-07"], stats)).toBe(false);
  });
});
