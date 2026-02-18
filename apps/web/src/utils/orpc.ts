import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTauriBearer, isTauriRuntime } from "@/lib/tauri-desktop";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const queryKey = query.queryKey;
      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: () => {
            // Retry only the failed query to avoid cascading refetches.
            queryClient.invalidateQueries({ queryKey });
          },
        },
      });
    },
  }),
});

const tauri = isTauriRuntime();

const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_WEB_URL}/api/rpc`,
  plugins: [new RetryAfterPlugin({ maxAttempts: 2 })],
  fetch(_url, options) {
    return fetch(_url, {
      ...options,
      credentials: "include",
    });
  },
  headers: async () => {
    if (typeof window !== "undefined") {
      const h: Record<string, string> = {
        "x-request-start": Date.now().toString(),
      };
      // In Tauri, authenticate ORPC calls via bearer token instead of
      // cookies. WKWebView ITP blocks cross-origin cookies in production.
      if (tauri) {
        const token = getTauriBearer();
        if (token) {
          h.Authorization = `Bearer ${token}`;
        }
      }
      return h;
    }

    const { headers } = await import("next/headers");
    return Object.fromEntries(await headers());
  },
});

export const orpc: AppRouterClient = createORPCClient(link);
