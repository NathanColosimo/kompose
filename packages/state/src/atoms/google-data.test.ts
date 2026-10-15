import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import { createStore } from "jotai";
import { queryClientAtom } from "jotai-tanstack-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { stateConfigAtom } from "../config";
import { setStorageAdapter } from "../storage";
import type { OrpcUtils } from "../types";
import { resolvedVisibleCalendarIdsAtom } from "./google-data";
import { visibleCalendarsAtom } from "./visible-calendars";

test("a signed-out account response does not erase saved calendar selection", async () => {
  const saved = [{ accountId: "google-provider-id", calendarId: "primary" }];
  const writes: string[] = [];
  setStorageAdapter({
    getItem: () => JSON.stringify(saved),
    removeItem: () => undefined,
    setItem: (_key, value) => {
      writes.push(value);
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(LINKED_ACCOUNTS_QUERY_KEY, []);
  const store = createStore();
  store.set(queryClientAtom, client);
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: async () => ({ data: [] }),
      unlinkAccount: async () => undefined,
    },
    orpc: {} as OrpcUtils,
  });
  const unsubscribe = store.sub(visibleCalendarsAtom, () => undefined);
  try {
    expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual([]);
    await Promise.resolve();
    expect(store.get(visibleCalendarsAtom)).toEqual(saved);
    expect(writes).toEqual([]);
  } finally {
    unsubscribe();
    client.clear();
  }
});
