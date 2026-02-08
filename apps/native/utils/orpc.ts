import type { AppRouterClient } from "@kompose/api/routers/index";
import { TASKS_QUERY_KEY } from "@kompose/state/atoms/tasks";
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  GOOGLE_CALENDARS_QUERY_KEY,
  GOOGLE_EVENTS_QUERY_KEY,
} from "@kompose/state/google-calendar-query-keys";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

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
  headers() {
    const headers = new Map<string, string>();
    const cookies = authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
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
