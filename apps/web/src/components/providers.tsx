"use client";

import { StateProvider } from "@kompose/state/state-provider";
import { createWebStorageAdapter } from "@kompose/state/storage";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { toast } from "sonner";
import { useWebRealtimeSync } from "@/hooks/use-realtime-sync";
import { authClient } from "@/lib/auth-client";
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

export default function Providers({ children }: { children: React.ReactNode }) {
  const storage = useMemo(() => createWebStorageAdapter(), []);
  const stateAuthClient = useMemo(
    () => ({
      useSession: authClient.useSession,
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
            {children}
          </StateProvider>
          {showReactQueryDevtools ? <ReactQueryDevtools /> : null}
        </QueryClientProvider>
      </TauriUpdaterProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
