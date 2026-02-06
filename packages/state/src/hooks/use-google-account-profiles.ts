"use client";

import { useQueries } from "@tanstack/react-query";
import type { Account, OAuth2UserInfo } from "better-auth";
import { useMemo } from "react";
import { useStateConfig } from "../config";
import { useGoogleAccounts } from "./use-google-accounts";

export interface GoogleAccountProfile {
  account: Account;
  profile: OAuth2UserInfo | null;
  isLoading: boolean;
}

/**
 * Returns linked Google accounts enriched with profile metadata from provider.
 */
export function useGoogleAccountProfiles() {
  const { authClient } = useStateConfig();
  const { data: googleAccounts = [], isLoading: isAccountsLoading } =
    useGoogleAccounts();

  const profileQueries = useQueries({
    queries: googleAccounts.map((account) => ({
      // Better Auth accountInfo expects provider accountId for lookup.
      queryKey: ["google-account-info", account.accountId],
      queryFn: async (): Promise<OAuth2UserInfo | null> => {
        try {
          return await authClient.accountInfo(account.accountId);
        } catch {
          return null;
        }
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  const profiles = useMemo<GoogleAccountProfile[]>(
    () =>
      googleAccounts.map((account, index) => {
        const query = profileQueries[index];
        return {
          account,
          profile: query?.data ?? null,
          isLoading: Boolean(query?.isLoading),
        };
      }),
    [googleAccounts, profileQueries]
  );

  return {
    profiles,
    isLoading: isAccountsLoading || profileQueries.some((q) => q.isLoading),
  };
}
