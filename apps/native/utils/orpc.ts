import type { AppRouterClient } from "@kompose/api/routers/index";
import { TASKS_QUERY_KEY } from "@kompose/state/atoms/tasks";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  GOOGLE_CALENDARS_QUERY_KEY,
  GOOGLE_EVENTS_QUERY_KEY,
} from "@kompose/state/google-calendar-query-keys";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { uuidv7 } from "uuidv7";
import { authClient } from "@/lib/auth-client";

/**
 * Generate a W3C traceparent header for distributed tracing.
 * Uses uuidv7 for time-ordered trace IDs, making it easier to
 * correlate traces with request timing in Axiom.
 * Lightweight alternative to a full OTel SDK on React Native --
 * gives trace correlation on the backend without client-side spans.
 */
function generateTraceparent(): string {
  const traceId = uuidv7().replace(/-/g, "");
  const parentId = uuidv7().replace(/-/g, "").slice(0, 16);
  return `00-${traceId}-${parentId}-01`;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: 1,
    },
  },
});

export const link = new RPCLink({
  /**
   * Base URL for the Next.js server that hosts `/api/rpc`.
   *
   * We keep a small fallback so the app doesn't silently build an invalid URL
   * when `.env` isn't configured yet.
   */
  url: `${process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:3001"}/api/rpc`,
  plugins: [new RetryAfterPlugin({ maxAttempts: 2 })],
  headers() {
    const headers = new Map<string, string>();
    const cookies = authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    // Inject traceparent for distributed tracing correlation
    headers.set("traceparent", generateTraceparent());
    // Client timestamp for network latency measurement on the server
    headers.set("x-request-start", Date.now().toString());
    return Object.fromEntries(headers);
  },
  // React Native's built-in fetch does not support SSE / ReadableStream.
  // expo/fetch provides streaming support required for oRPC eventIterator.
  async fetch(request, init) {
    return expoFetch(request.url, {
      body: await request.blob(),
      headers: request.headers,
      method: request.method,
      signal: request.signal,
      ...init,
    });
  },
});

export const orpc: AppRouterClient = createORPCClient(link);

export function invalidateSessionQueries() {
  queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_ACCOUNTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY });
}

export function clearSessionQueries() {
  queryClient.removeQueries({ queryKey: TASKS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_ACCOUNTS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_CALENDARS_QUERY_KEY });
  queryClient.removeQueries({ queryKey: GOOGLE_EVENTS_QUERY_KEY });
}
