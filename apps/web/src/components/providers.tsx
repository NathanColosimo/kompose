"use client";

import { env } from "@kompose/env";
import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWebRealtimeSync } from "@/hooks/use-realtime-sync";
import { authClient } from "@/lib/auth-client";
import {
  getExternalHttpUrl,
  initTauriBearer,
  isTauriRuntime,
  openUrlInDesktopBrowser,
  syncDesktopCommandBarShortcutPreset,
} from "@/lib/tauri-desktop";
import { orpc, queryClient } from "@/utils/orpc";
import { DeepLinkHandler } from "./deep-link-handler";
import { TauriUpdaterProvider } from "./tauri-updater";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then(
      (mod) => mod.ReactQueryDevtools
    ),
  { ssr: false }
);

function RealtimeSyncBootstrap() {
  useWebRealtimeSync();
  return null;
}

/**
 * Loads the bearer token from Tauri Store into memory before rendering
 * children. This ensures the first getSession / ORPC call already has
 * the token available. On web (non-Tauri) this is a no-op pass-through.
 *
 * Must be rendered inside QueryClientProvider so it can clear any query
 * results that fired during the brief initial render (before the token
 * was available). Starts with ready=true to match the server/static-export
 * render and avoid a hydration mismatch.
 */
function TauriBearerInit({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    setReady(false);
    initTauriBearer().then(() => {
      // Wipe any query results from the brief initial render that ran
      // without the bearer token (e.g. session returning null).
      qc.clear();
      setReady(true);
    });
  }, [qc]);

  if (!ready) {
    return null;
  }

  return children;
}

function TauriDesktopBridgeBootstrap() {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    // Apply the persisted command-bar shortcut preset after desktop startup.
    syncDesktopCommandBarShortcutPreset().catch((error) => {
      console.warn(
        "Failed to sync desktop command bar shortcut preset.",
        error
      );
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    // Delegate external-link clicks globally so meeting/maps/etc. all work in desktop.
    const handleDocumentClickCapture = (event: MouseEvent) => {
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
      openUrlInDesktopBrowser(externalUrl).catch((error) => {
        console.warn("Failed to open external URL via desktop browser.", error);
      });
    };

    document.addEventListener("click", handleDocumentClickCapture, true);

    return () => {
      document.removeEventListener("click", handleDocumentClickCapture, true);
    };
  }, []);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const storage = useMemo(() => createWebStorageAdapter(), []);
  const stateAuthClient = useMemo(
    () => ({
      getSession: async () => {
        const result = await authClient.getSession({
          query: {
            // Route guards rely on server truth during auth transitions.
            disableCookieCache: true,
          },
        });
        if (!(result && "data" in result)) {
          return null;
        }
        return { data: result.data };
      },
      listAccounts: async () => {
        const result = await authClient.listAccounts();
        if (!(result && "data" in result) || result.data == null) {
          return null;
        }
        return { data: result.data };
      },
      accountInfo: async (accountId: string) => {
        const result = await authClient.accountInfo({
          query: { accountId },
        });
        return result?.data?.user ?? null;
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
                providerId: account.providerId,
                accountId,
              },
              {
                onSuccess: () => {
                  resolve();
                },
                onError: (error) => {
                  reject(
                    new Error(
                      error.error.message ||
                        error.error.statusText ||
                        "Failed to unlink account."
                    )
                  );
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
      orpc,
      authClient: stateAuthClient,
      notifyError: (error: Error) => {
        toast.error(error.message);
      },
    }),
    [stateAuthClient]
  );
  const pathname = usePathname();
  const isCommandBarRoute = pathname === "/desktop/command-bar";
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
        <TauriBearerInit>
          <TauriUpdaterProvider>
            <StateProvider config={config} storage={storage}>
              <RealtimeSyncBootstrap />
              <TauriDesktopBridgeBootstrap />
              <DeepLinkHandler />
              {children}
            </StateProvider>
          </TauriUpdaterProvider>
        </TauriBearerInit>
        {showReactQueryDevtools ? <ReactQueryDevtools /> : null}
      </QueryClientProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
