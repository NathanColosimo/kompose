import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface CreateAppQueryClientOptions {
  suppressToasts: boolean;
}

export function createAppQueryClient({
  suppressToasts,
}: CreateAppQueryClientOptions) {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (suppressToasts) {
          return;
        }

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

  return queryClient;
}

const link = new RPCLink({
  fetch(url, init) {
    return globalThis.fetch(url, {
      ...init,
      credentials: "include",
    });
  },
  headers: async () => {
    if (typeof window !== "undefined") {
      const h: Record<string, string> = {
        "x-request-start": Date.now().toString(),
      };
      return h;
    }

    const { headers } = await import("next/headers");
    return Object.fromEntries(await headers());
  },
  origin: env.NEXT_PUBLIC_WEB_URL,
  plugins: [new RetryAfterLinkPlugin({ maxAttempts: 2 })],
  url: "/api/rpc",
});

export const orpc: AppRouterClient = createORPCClient(link);
