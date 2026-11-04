import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryPersister } from "@/lib/query-persistence";

interface CreateAppQueryClientOptions {
  suppressToasts: boolean;
}

/**
 * A signed-out request. The session check redirects to /login, so there is
 * nothing to retry or report. It can happen when the dashboard renders from a
 * stored session whose cookie has since been revoked.
 */
function isUnauthorized(error: unknown) {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

export function createAppQueryClient({
  suppressToasts,
}: CreateAppQueryClientOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        persister: queryPersister.persisterFn,
        retry: (failureCount, error) =>
          !isUnauthorized(error) && failureCount < 3,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (suppressToasts || isUnauthorized(error)) {
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
