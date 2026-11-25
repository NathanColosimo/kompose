import type { AppRouterClient } from "@kompose/api/routers/index";
import { clientEnv } from "@kompose/env/client";
import { errorMessage, isUnauthorized } from "@kompose/state/errors";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

interface CreateAppQueryClientOptions {
  suppressToasts: boolean;
}

export function createAppQueryClient({
  suppressToasts,
}: CreateAppQueryClientOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The dashboard's queries start before its session check returns, so
        // a signed-out visitor gets a 401; the layout redirects to /login.
        retry: (failureCount, error) =>
          !isUnauthorized(error) && failureCount < 3,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthorized(error)) {
          // Refetch cancels the current check, so a burst of 401s must share one.
          const session = authClient.$store.atoms.session.get();
          if (session.data && !session.isRefetching) {
            session.refetch();
          }
          return;
        }
        if (suppressToasts) {
          return;
        }

        const queryKey = query.queryKey;
        toast.error(errorMessage(error), {
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
  origin: clientEnv.NEXT_PUBLIC_WEB_URL,
  plugins: [new RetryAfterLinkPlugin({ maxAttempts: 2 })],
  url: "/api/rpc",
});

export const orpc: AppRouterClient = createORPCClient(link);
