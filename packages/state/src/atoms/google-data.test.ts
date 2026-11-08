import { expect, test } from "bun:test";
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
import { resolvedVisibleCalendarIdsAtom } from "./google-data";
import { visibleCalendarsAtom } from "./visible-calendars";

test("a failed calendar list keeps saved IDs while successful lists filter missing IDs", async () => {
  const saved = [
    { accountId: "personal", calendarId: "primary" },
    { accountId: "work", calendarId: "removed" },
  ];
  setStorageAdapter({
    getItem: () => JSON.stringify(saved),
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  const store = createStore();
  const pendingRequest = new Promise<never>(() => {
    // Keep external discovery pending; the query cache supplies the results.
  });
  store.set(queryClientAtom, client);
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: () => pendingRequest,
      unlinkAccount: () => Promise.reject(new Error("Unexpected unlink")),
    },
    orpc: createORPCClient<AppRouterClient>({ call: () => pendingRequest }),
  });
  client.setQueryData<Account[]>(
    LINKED_ACCOUNTS_QUERY_KEY,
    ["personal", "work"].map((accountId) => ({
      accountId,
      createdAt: new Date(0),
      id: accountId,
      providerId: "google",
      updatedAt: new Date(0),
      userId: "user",
    }))
  );
  client.setQueryData(getGoogleCalendarsQueryKey("work"), []);
  await expect(
    client.fetchQuery({
      queryFn: () => Promise.reject(new Error("Calendar discovery failed")),
      queryKey: getGoogleCalendarsQueryKey("personal"),
    })
  ).rejects.toThrow("Calendar discovery failed");

  const unsubscribe = store.sub(
    resolvedVisibleCalendarIdsAtom,
    () => undefined
  );
  try {
    expect(store.get(resolvedVisibleCalendarIdsAtom)).toEqual([
      { accountId: "personal", calendarId: "primary" },
    ]);
    expect(store.get(visibleCalendarsAtom)).toEqual(saved);
  } finally {
    unsubscribe();
    client.clear();
  }
});
