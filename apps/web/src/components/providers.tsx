"use client";

import { env } from "@kompose/env";
import type { SubscribeToResume } from "@kompose/state/hooks/use-today-tick";
import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/next";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import {
  getExternalHttpUrl,
  initTauriBearer,
  isTauriRuntime,
  openUrlInDesktopBrowser,
  syncDesktopCommandBarShortcutPreset,
} from "@/lib/tauri-desktop";
import { isToastSuppressedPath } from "@/lib/toast-suppression";
import { createAppQueryClient, orpc } from "@/utils/orpc";
import { DeepLinkHandler } from "./deep-link-handler";
import { TauriUpdaterProvider } from "./tauri-updater";
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
  if (isTauriRuntime()) {
    return null;
  }
  return <Analytics />;
}

/**
 * Loads the bearer token from Tauri Store into memory before rendering
 * children. This ensures the first getSession / ORPC call already has
 * the token available. On web (non-Tauri) this is a no-op pass-through.
 *
 * Must be rendered inside QueryClientProvider so it can clear any query
 * results that fired during the brief initial render (before the token
 * was available). The idle state preserves the server/static-export render;
 * Tauri switches to loading after mount, then remounts children once the
 * bearer token is available.
 */
function TauriBearerInit({ children }: { children: React.ReactNode }) {
  const [bearerState, setBearerState] = useState<"idle" | "loading" | "ready">(
    "idle"
  );
  const qc = useQueryClient();

  useMountEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    setBearerState("loading");
    initTauriBearer().then(() => {
      qc.clear();
      setBearerState("ready");
    });
  });

  if (bearerState === "loading") {
    return null;
  }

  return children;
}

function TauriDesktopBridgeBootstrap() {
  useMountEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    syncDesktopCommandBarShortcutPreset().catch((error) => {
      console.warn(
        "Failed to sync desktop command bar shortcut preset.",
        error
      );
    });
  });

  useMountEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const handleDocumentClickCapture = async (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href) {
        return;
      }

      const externalUrl = getExternalHttpUrl(href, window.location.origin);
      if (!externalUrl) {
        return;
      }

      event.preventDefault();
      await openUrlInDesktopBrowser(externalUrl);
    };

    document.addEventListener("click", handleDocumentClickCapture, true);

    return () => {
      document.removeEventListener("click", handleDocumentClickCapture, true);
    };
  });

  return null;
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
        const accountsResult = await authClient.listAccounts();
        const accounts = accountsResult?.data ?? [];
        const account = accounts.find(
          (linkedAccount) => linkedAccount.accountId === accountId
        );

        if (!account) {
          throw new Error("Account not found.");
        }

        await new Promise<void>((resolve, reject) => {
          authClient
            .unlinkAccount(
              {
                accountId,
                providerId: account.providerId,
              },
              {
                onError: (error) => {
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
  const appProviders = (
    <StateProvider
      config={config}
      storage={storage}
      subscribeToResume={webSubscribeToResume}
    >
      <TauriDesktopBridgeBootstrap />
      {isCommandBarRoute ? null : <DeepLinkHandler />}
      {children}
    </StateProvider>
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <QueryClientProvider client={queryClient}>
        <TauriBearerInit>
          {/* Keep updater ownership in the main desktop window only. */}
          {isCommandBarRoute ? (
            appProviders
          ) : (
            <TauriUpdaterProvider>{appProviders}</TauriUpdaterProvider>
          )}
        </TauriBearerInit>
        {showReactQueryDevtools ? <ReactQueryDevtools /> : null}
      </QueryClientProvider>
      {isCommandBarRoute ? null : <Toaster richColors />}
      <VercelAnalytics />
    </ThemeProvider>
  );
}
