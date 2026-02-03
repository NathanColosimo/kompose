import type { AppRouterClient } from "@kompose/api/routers/index";
import { TASKS_QUERY_KEY } from "@kompose/state/atoms/tasks";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
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
      // Prevent aggressive refetching that causes constant UI refreshes
      staleTime: 1000 * 60, // Consider data fresh for 1 minute
      refetchOnWindowFocus: true, // Don't refetch when app comes to foreground
      refetchOnMount: true, // Don't refetch on component mount if data exists
      retry: 1, // Only retry failed queries once
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

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

const GOOGLE_ACCOUNTS_QUERY_KEY = ["google-accounts"] as const;
const GOOGLE_CALENDARS_QUERY_KEY = ["google-calendars"] as const;
const GOOGLE_EVENTS_QUERY_KEY = orpc.googleCal.events.key();

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
