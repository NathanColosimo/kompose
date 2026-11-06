import type { AppRouterClient } from "@kompose/api/routers/index";
import { LINKED_ACCOUNTS_QUERY_KEY } from "@kompose/state/account-query-keys";
import { TASKS_QUERY_KEY } from "@kompose/state/atoms/tasks";
import {
  GOOGLE_ACCOUNT_INFO_QUERY_KEY,
  GOOGLE_CALENDARS_QUERY_KEY,
  GOOGLE_COLORS_QUERY_KEY,
  GOOGLE_EVENTS_QUERY_KEY,
} from "@kompose/state/google-calendar-query-keys";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import {
  type FetchRequestInit as ExpoFetchInit,
  fetch as expoFetch,
} from "expo/fetch";
import { uuidv7 } from "uuidv7";
import { authClient } from "@/lib/auth-client";
import { env } from "@/lib/env";

/** Correlate server traces without a native OTel SDK; see documents/otel.md. */
function generateTraceparent(): string {
  const traceId = uuidv7().replace(/-/g, "");
  const parentId = uuidv7().replace(/-/g, "").slice(0, 16);
  return `00-${traceId}-${parentId}-01`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 1000 * 60,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
});

const link = new RPCLink({
  // React Native's built-in fetch does not support SSE / ReadableStream.
  // expo/fetch provides streaming support required for oRPC eventIterator.
  async fetch(url, init) {
    const response = await expoFetch(url, {
      ...(init as ExpoFetchInit),
      // headers() attaches the Better Auth cookie. Native cookie handling on
      // iOS can interfere with that header and break session resolution.
      credentials: "omit",
    });
    return response as unknown as Response;
  },
  async headers() {
    const headers = new Map<string, string>();
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    headers.set("traceparent", generateTraceparent());
    // Client timestamp for network latency measurement on the server
    headers.set("x-request-start", Date.now().toString());
    return Object.fromEntries(headers);
  },
  origin: env.EXPO_PUBLIC_SERVER_URL,
  plugins: [new RetryAfterLinkPlugin({ maxAttempts: 2 })],
  url: "/api/rpc",
});

export const orpc: AppRouterClient = createORPCClient(link);

export function invalidateAuthenticatedQueries() {
  queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_COLORS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY });
}

export function clearAuthenticatedQueries() {
  queryClient.removeQueries({ queryKey: TASKS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: LINKED_ACCOUNTS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_ACCOUNT_INFO_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_COLORS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY });
}
