import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
      // Client timestamp for network latency measurement on the server
      return { "x-request-start": Date.now().toString() };
    }

    const { headers } = await import("next/headers");
    return Object.fromEntries(await headers());
  },
});

export const orpc: AppRouterClient = createORPCClient(link);
