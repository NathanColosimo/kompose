import type { AppRouterClient } from "@kompose/api/routers/index";
import { env } from "@kompose/env";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RetryAfterLinkPlugin } from "@orpc/client/plugins";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { refetchSessionIfSignedIn, SignedOutError } from "@/lib/auth-client";

interface CreateAppQueryClientOptions {
  suppressToasts: boolean;
}

/**
 * A request made without a session. There's nothing to retry or report: the
 * dashboard's session check redirects to /login. Its queries start before that
 * check returns (see DashboardQueries), so a signed-out visitor gets these.
 * After sign-in they mean the session ended, so the session is refetched.
 */
function isSignedOut(error: unknown) {
  return (
    error instanceof SignedOutError ||
    (error instanceof ORPCError && error.code === "UNAUTHORIZED")
  );
}

export function createAppQueryClient({
  suppressToasts,
}: CreateAppQueryClientOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isSignedOut(error) && failureCount < 3,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isSignedOut(error)) {
          refetchSessionIfSignedIn();
          return;
        }
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
