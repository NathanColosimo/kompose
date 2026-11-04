import {
  type TaskSelectDecoded,
  type TaskSelectEncoded,
  taskSelectCodec,
} from "@kompose/api/routers/task/contract";
import {
  experimental_createQueryPersister,
  type PersistedQuery,
} from "@tanstack/query-persist-client-core";
import type { Query } from "@tanstack/react-query";
import { clear, createStore, del, entries, get, set } from "idb-keyval";

/**
 * Bump when a persisted query's data shape changes, so old entries are
 * discarded instead of being read by code that expects the new shape.
 */
const CACHE_VERSION = "1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

/** Queries the dashboard needs for its first paint. */
const PERSISTED_QUERY_ROOTS = new Set([
  "google-account-info",
  "google-calendars",
  "google-colors",
  "google-events",
  "linked-accounts",
  "tags",
  "tasks",
  "whoop",
]);

const store =
  typeof indexedDB === "undefined"
    ? null
    : createStore("kompose-query-cache", "queries");

// Entries are keyed by user, so one user's data is never restored for another.
let cacheUserId: string | null = null;

/** Point the cache at the signed-in user; `null` stops reads and writes. */
export function setQueryCacheUser(userId: string | null) {
  cacheUserId = userId;
}
export function getQueryCacheUser() {
  return cacheUserId;
}

/** Delete every persisted query, for sign-out or a change of user. */
export function clearPersistedQueries() {
  return store ? clear(store) : Promise.resolve();
}

// Temporal values can't be structured-cloned into IndexedDB, so tasks are
// stored in their wire format and decoded again on restore.
function encodeData(root: unknown, data: unknown) {
  return root === "tasks"
    ? (data as TaskSelectDecoded[]).map((task) => taskSelectCodec.encode(task))
    : data;
}
function decodeData(root: unknown, data: unknown) {
  return root === "tasks"
    ? (data as TaskSelectEncoded[]).map((task) => taskSelectCodec.parse(task))
    : data;
}

/**
 * Restores the dashboard's queries from IndexedDB on their first fetch, so a
 * reload or app launch paints the last data at once. Every restored query
 * refetches right away: while the app was closed, realtime sync wasn't
 * listening, so restored data can't count as fresh.
 */
export const queryPersister = experimental_createQueryPersister<PersistedQuery>(
  {
    buster: CACHE_VERSION,
    deserialize: (persisted) => ({
      ...persisted,
      state: {
        ...persisted.state,
        data: decodeData(persisted.queryKey[0], persisted.state.data),
      },
    }),
    filters: {
      predicate: (query: Query) =>
        PERSISTED_QUERY_ROOTS.has(String(query.queryKey[0])),
    },
    maxAge: MAX_AGE_MS,
    refetchOnRestore: "always",
    serialize: (persisted) => ({
      ...persisted,
      // Only the data is needed to restore; errors may not be cloneable.
      state: {
        ...persisted.state,
        data: encodeData(persisted.queryKey[0], persisted.state.data),
        error: null,
        fetchFailureReason: null,
      },
    }),
    storage: store && {
      // Keys come back without the user prefix, as the other methods take them.
      entries: async () => {
        if (!cacheUserId) {
          return [];
        }
        const prefix = `${cacheUserId}:`;
        const all = await entries<string, PersistedQuery>(store);
        return all
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]): [string, PersistedQuery] => [
            key.slice(prefix.length),
            value,
          ]);
      },
      getItem: (key) =>
        cacheUserId
          ? get<PersistedQuery>(`${cacheUserId}:${key}`, store)
          : null,
      removeItem: (key) =>
        cacheUserId ? del(`${cacheUserId}:${key}`, store) : undefined,
      setItem: (key, value) =>
        cacheUserId ? set(`${cacheUserId}:${key}`, value, store) : undefined,
    },
  }
);
