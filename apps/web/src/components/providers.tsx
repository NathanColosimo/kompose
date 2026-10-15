"use client";

import { env } from "@kompose/env";
import type { SubscribeToResume } from "@kompose/state/hooks/use-today-tick";
import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/next";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";
import { isToastSuppressedPath } from "@/lib/toast-suppression";
import { createAppQueryClient, orpc } from "@/utils/orpc";
import { DesktopAuth } from "./desktop-auth";
import { ThemeProvider } from "./theme-provider";
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

function VercelAnalytics() {
  if (isDesktopRuntime()) {
    return null;
  }
  return <Analytics />;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const suppressToasts = isToastSuppressedPath(pathname);
  const [queryClient] = useState(() =>
    createAppQueryClient({ suppressToasts })
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
      listAccounts: async () => {
        const result = await authClient.listAccounts();
        if (
          !(result && "data" in result) ||
          result.data === null ||
          result.data === undefined
        ) {
          return null;
        }
        return { data: result.data };
      },
      unlinkAccount: async ({ accountId }: { accountId: string }) => {
        await new Promise<void>((resolve, reject) => {
          authClient
            .unlinkAccount(
              { accountId },
              {
                onError: (error: {
                  error?: { message?: string; statusText?: string };
                }) => {
                  reject(
                    new Error(
                      error.error?.message ||
                        error.error?.statusText ||
                        "Failed to unlink account."
                    )
                  );
                },
                onSuccess: () => {
                  resolve();
                },
              }
            )
            .catch((error: unknown) => {
              reject(
                error instanceof Error
                  ? error
                  : new Error("Failed to unlink account.")
              );
            });
        });
      },
    }),
    []
  );
  const config = useMemo(
    () => ({
      authClient: stateAuthClient,
      notifyError: (error: Error) => {
        if (suppressToasts) {
          return;
        }

        toast.error(error.message);
      },
      orpc,
    }),
    [stateAuthClient, suppressToasts]
  );
  const isCommandBarRoute = suppressToasts;
  const showReactQueryDevtools =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV !== "production" && !isCommandBarRoute;

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
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
      </QueryClientProvider>
      {isCommandBarRoute ? null : <Toaster richColors />}
      <VercelAnalytics />
    </ThemeProvider>
  );
}
