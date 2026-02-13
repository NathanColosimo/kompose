"use client";

import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useWebRealtimeSync } from "@/hooks/use-realtime-sync";
import { authClient } from "@/lib/auth-client";
import {
  getExternalHttpUrl,
  isTauriRuntime,
  openUrlInDesktopBrowser,
} from "@/lib/tauri-desktop";
import { orpc, queryClient } from "@/utils/orpc";
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

function TauriDesktopBridgeBootstrap() {
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
  // Only mount devtools in development to avoid production overhead.
  const showReactQueryDevtools = process.env.NODE_ENV === "development";

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <TauriUpdaterProvider>
        <QueryClientProvider client={queryClient}>
          <StateProvider config={config} storage={storage}>
            <RealtimeSyncBootstrap />
            <TauriDesktopBridgeBootstrap />
            {children}
          </StateProvider>
          {showReactQueryDevtools ? <ReactQueryDevtools /> : null}
        </QueryClientProvider>
      </TauriUpdaterProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
