import { afterEach, describe, expect, test } from "bun:test";
import type { AppRouterClient } from "@kompose/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { QueryClient } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { createStore } from "jotai";
import { queryClientAtom } from "jotai-tanstack-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { stateConfigAtom } from "../config";
import { getGoogleCalendarsQueryKey } from "../google-calendar-query-keys";
import { setStorageAdapter } from "../storage";
import {
  type CalendarWithSource,
  resolvedVisibleCalendarIdsAtom,
} from "./google-data";
import {
  type VisibleCalendars,
  visibleCalendarsAtom,
} from "./visible-calendars";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function account(accountId: string): Account {
  return {
    accountId,
    createdAt: new Date(0),
    id: accountId,
    providerId: "google",
    updatedAt: new Date(0),
    userId: "user",
  };
}

function setup(selection: VisibleCalendars) {
  const storage = new Map([["visible-calendars", JSON.stringify(selection)]]);
  setStorageAdapter({
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        retryOnMount: false,
      },
    },
  });
  const store = createStore();
  const pendingRequest = new Promise<never>(() => {
    // Hold external discovery open so tests control loading through the cache.
  });
  store.set(queryClientAtom, client);
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: () => pendingRequest,
      unlinkAccount: () => Promise.reject(new Error("Unexpected unlink")),
    },
    orpc: createORPCClient<AppRouterClient>({
      call: () => pendingRequest,
    }),
  });
  cleanups.push(() => client.clear());

  return {
    client,
    start: () => {
      cleanups.unshift(
        store.sub(resolvedVisibleCalendarIdsAtom, () => undefined)
      );
    },
    storage,
    store,
  };
}

describe("resolvedVisibleCalendarIdsAtom", () => {
  test("keeps a saved calendar when its calendar-list query fails", async () => {
    const saved = [{ accountId: "personal", calendarId: "primary" }];
    const { client, start, storage, store } = setup(saved);
    client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("personal")]);
    await expect(
      client.fetchQuery({
        queryFn: () => Promise.reject(new Error("Calendar discovery failed")),
        queryKey: getGoogleCalendarsQueryKey("personal"),
      })
    ).rejects.toThrow("Calendar discovery failed");

    start();

    expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual(saved);
    await Promise.resolve();
    expect(store.get(visibleCalendarsAtom)).toEqual(saved);
    expect(storage.get("visible-calendars")).toBe(JSON.stringify(saved));
  });

  test.each(["loading", "error"])(
    "filters successful discovery independently of another account's %s query",
    async (status) => {
      const saved = [
        { accountId: "personal", calendarId: "primary" },
        { accountId: "personal", calendarId: "removed" },
        { accountId: "work", calendarId: "primary" },
      ];
      const { client, start, storage, store } = setup(saved);
      client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [
        account("personal"),
        account("work"),
      ]);
      client.setQueryData<CalendarWithSource[]>(
        getGoogleCalendarsQueryKey("personal"),
        [
          {
            accountId: "personal",
            calendar: { id: "primary", summary: "Personal" },
          },
        ]
      );
      if (status === "error") {
        await expect(
          client.fetchQuery({
            queryFn: () => Promise.reject(new Error("Work discovery failed")),
            queryKey: getGoogleCalendarsQueryKey("work"),
          })
        ).rejects.toThrow("Work discovery failed");
      }

      start();

      expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual([
        { accountId: "personal", calendarId: "primary" },
        { accountId: "work", calendarId: "primary" },
      ]);
      await Promise.resolve();
      expect(storage.get("visible-calendars")).toBe(JSON.stringify(saved));
    }
  );

  test("keeps saved ids when a refresh fails with cached calendar data", async () => {
    const saved = [{ accountId: "personal", calendarId: "primary" }];
    const { client, start, store } = setup(saved);
    client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("personal")]);
    client.setQueryData(getGoogleCalendarsQueryKey("personal"), []);
    await expect(
      client.fetchQuery({
        queryFn: () => Promise.reject(new Error("Calendar refresh failed")),
        queryKey: getGoogleCalendarsQueryKey("personal"),
      })
    ).rejects.toThrow("Calendar refresh failed");

    start();

    expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual(saved);
  });

  test.each(["loading", "error", "success"])(
    "only removes an unlinked account after successful account discovery (%s)",
    async (status) => {
      const saved = [{ accountId: "unlinked", calendarId: "primary" }];
      const { client, start, storage, store } = setup(saved);
      if (status === "success") {
        client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, []);
      }
      if (status === "error") {
        await expect(
          client.fetchQuery({
            queryFn: () =>
              Promise.reject(new Error("Account discovery failed")),
            queryKey: LINKED_ACCOUNTS_QUERY_KEY,
          })
        ).rejects.toThrow("Account discovery failed");
      }

      start();

      expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual(
        status === "success" ? [] : saved
      );
      await Promise.resolve();
      expect(storage.get("visible-calendars")).toBe(JSON.stringify(saved));
    }
  );

  test("a successful empty calendar list proves a saved calendar is gone", () => {
    const saved = [{ accountId: "personal", calendarId: "removed" }];
    const { client, start, store } = setup(saved);
    client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("personal")]);
    client.setQueryData(getGoogleCalendarsQueryKey("personal"), []);

    start();

    expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual([]);
  });

  const visibilityCases: { selection: VisibleCalendars }[] = [
    { selection: null },
    { selection: [] },
  ];
  test.each(visibilityCases)(
    "preserves default visibility and explicit hide-all (%j)",
    ({ selection }) => {
      const { client, start, store } = setup(selection);
      client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, [account("personal")]);
      client.setQueryData<CalendarWithSource[]>(
        getGoogleCalendarsQueryKey("personal"),
        [
          {
            accountId: "personal",
            calendar: { id: "primary", summary: "Personal" },
          },
        ]
      );

      start();

      expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual(
        selection === null
          ? [{ accountId: "personal", calendarId: "primary" }]
          : []
      );
    }
  );
});
