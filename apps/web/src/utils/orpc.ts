import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { errorMessage } from "@kompose/state/errors";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

interface CreateAppQueryClientOptions {
  suppressToasts: boolean;
}

/**
 * The dashboard's queries start before its session check returns, so a
 * signed-out visitor gets these; the layout redirects to /login.
 */
function isUnauthorized(error: Error) {
  if (error instanceof ORPCError) {
    return error.code === "UNAUTHORIZED";
  }
  // Better Auth's BetterFetchError (not exported at runtime) carries the status.
  return "status" in error && error.status === 401;
}

export function createAppQueryClient({
  suppressToasts,
}: CreateAppQueryClientOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !isUnauthorized(error) && failureCount < 3,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthorized(error)) {
          // With a session loaded, the session ended (revoked or expired), and
          // Better Auth only rechecks on focus. Refetching shows no session and
          // the layout redirects. Without one, the initial check is in flight
          // and a refetch would restart it.
          const session = authClient.$store.atoms.session.get();
          if (session.data) {
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
  origin: env.NEXT_PUBLIC_WEB_URL,
  plugins: [new RetryAfterLinkPlugin({ maxAttempts: 2 })],
  url: "/api/rpc",
});

export const orpc: AppRouterClient = createORPCClient(link);
