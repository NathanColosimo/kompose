import { useQuery } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { authClient } from "@/lib/auth-client";

/**
 * Returns linked Better Auth accounts filtered to Google provider.
 *
 * We use `authClient.listAccounts()` (same call as the web atoms) so the
 * `account.id` can be passed to the googleCal RPC endpoints.
 */
export function useGoogleAccounts() {
  return useQuery({
    queryKey: ["google-accounts"],
    queryFn: async (): Promise<Account[]> => {
      const result = await authClient.listAccounts();
      const accounts = result?.data ?? [];
      return accounts.filter((account) => account.providerId === "google");
    },
    staleTime: 5 * 60 * 1000,
  });
}
