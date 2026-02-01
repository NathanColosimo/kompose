"use client";

import { useQuery } from "@tanstack/react-query";
import type { Account } from "better-auth";
import { useAtomValue } from "jotai";
import { hasSessionAtom, useStateConfig } from "../config";

/**
 * Returns linked Better Auth accounts filtered to Google provider.
 */
export function useGoogleAccounts() {
  const { authClient } = useStateConfig();
  const hasSession = useAtomValue(hasSessionAtom);

  return useQuery({
    queryKey: ["google-accounts"],
    enabled: hasSession,
    queryFn: async (): Promise<Account[]> => {
      const result = await authClient.listAccounts();
      const accounts = result?.data ?? [];
      return accounts.filter((account) => account.providerId === "google");
    },
    staleTime: 5 * 60 * 1000,
  });
}
