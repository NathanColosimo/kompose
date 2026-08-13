"use client";

import { useQuery } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { useStateConfig } from "../config";

/**
 * Returns linked Better Auth accounts filtered to Google provider.
 */
export function useGoogleAccounts() {
  const { authClient } = useStateConfig();

  return useQuery({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    queryFn: async (): Promise<Account[]> =>
      (await authClient.listAccounts())?.data ?? [],
    select: (accounts) =>
      accounts.filter((account) => account.providerId === "google"),
    staleTime: 5 * 60 * 1000,
  });
}
