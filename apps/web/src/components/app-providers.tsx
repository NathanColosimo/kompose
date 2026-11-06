"use client";

import { clientEnv } from "@kompose/env/client";
import { errorMessage } from "@kompose/state/errors";
import type { SubscribeToResume } from "@kompose/state/hooks/use-today-tick";
import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { createAppQueryClient, orpc } from "@/utils/orpc";
import { DesktopAuth } from "./desktop-auth";
import { Toaster } from "./ui/sonner";

/** Web resume subscriber: refreshes today/now atoms on tab visibility and window focus. */
const webSubscribeToResume: SubscribeToResume = (refresh) => {
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      refresh();
    }
  };
  const onFocus = () => refresh();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
  };
};

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then(
      (mod) => mod.ReactQueryDevtools
    ),
  { ssr: false }
);

/** Query, app state, toasts and desktop sign-in for the signed-in app routes. */
export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // The desktop command bar window never renders or emits toasts.
  const isCommandBarRoute = pathname === "/desktop/command-bar";
  const [queryClient] = useState(() =>
    createAppQueryClient({ suppressToasts: isCommandBarRoute })
  );
  const storage = useMemo(() => createWebStorageAdapter(), []);
  const stateAuthClient = useMemo(
    () => ({
      accountInfo: async (accountId: string) => {
        const result = await authClient.accountInfo({
          query: { accountId },
        });
        return result?.data?.user ?? null;
      },
      listAccounts: () =>
        authClient.listAccounts({ fetchOptions: { throw: true } }),
      unlinkAccount: async ({ accountId }: { accountId: string }) => {
        const { error } = await authClient.unlinkAccount({ accountId });
        if (error) {
          throw new Error(
            error.message || error.statusText || "Failed to unlink account."
          );
        }
      },
    }),
    []
  );
  const config = useMemo(
    () => ({
      authClient: stateAuthClient,
      notifyError: (error: Error) => {
        if (isCommandBarRoute) {
          return;
        }

        toast.error(errorMessage(error));
      },
      orpc,
    }),
    [isCommandBarRoute, stateAuthClient]
  );
  const showReactQueryDevtools =
    clientEnv.NEXT_PUBLIC_DEPLOYMENT_ENV !== "production" && !isCommandBarRoute;

  return (
    <QueryClientProvider client={queryClient}>
      <StateProvider
        config={config}
        storage={storage}
        subscribeToResume={webSubscribeToResume}
      >
        <DesktopAuth />
        {children}
      </StateProvider>
      {showReactQueryDevtools ? <ReactQueryDevtools /> : null}
      {isCommandBarRoute ? null : <Toaster richColors />}
    </QueryClientProvider>
  );
}
