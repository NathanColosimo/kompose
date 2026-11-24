"use client";

import { getPluginForProvider } from "@kompose/plugins";
import { useQuery } from "@tanstack/react-query";
import { LINKED_ACCOUNTS_QUERY_KEY } from "../account-query-keys";
import { useStateConfig } from "../config";

export function useGoogleAccounts() {
  const { authClient } = useStateConfig();

  return useQuery({
    queryFn: () => authClient.listAccounts(),
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    select: (accounts) =>
      accounts.filter(
        (account) =>
          getPluginForProvider(account.providerId)?.id === "google-calendar"
      ),
    staleTime: 5 * 60 * 1000,
  });
}
