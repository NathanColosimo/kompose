"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
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
      queryClient.invalidateQueries({ queryKey: ["google-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["google-account-info"] });
    },
  });
}
