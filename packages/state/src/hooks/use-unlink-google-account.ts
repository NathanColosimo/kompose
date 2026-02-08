"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { GOOGLE_ACCOUNTS_QUERY_KEY } from "../google-calendar-query-keys";
import type { UnlinkAccountInput } from "../types";

/**
 * Unlinks a Google account from the current user and refreshes account queries.
 */
export function useUnlinkGoogleAccount() {
  const { authClient } = useStateConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId }: UnlinkAccountInput) => {
      await authClient.unlinkAccount({ accountId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOOGLE_ACCOUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["google-account-info"] });
    },
  });
}
