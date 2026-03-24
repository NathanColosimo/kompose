"use client";

import { useQuery } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { useAtomValue } from "jotai";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { hasSessionAtom, useStateConfig } from "../config";

/**
 * Returns linked Better Auth accounts filtered to Google provider.
 */
export function useGoogleAccounts() {
  const { authClient } = useStateConfig();
  const hasSession = useAtomValue(hasSessionAtom);

  return useQuery({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    enabled: hasSession,
    queryFn: async (): Promise<Account[]> => {
      return (await authClient.listAccounts())?.data ?? [];
    },
    select: (accounts) =>
      accounts.filter((account) => account.providerId === "google"),
    staleTime: 5 * 60 * 1000,
  });
}
