import type { AppRouterClient } from "@kompose/api/routers/index";
import type { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { Account, OAuth2UserInfo } from "better-auth";

export interface UnlinkAccountInput {
  accountId: string;
}

/**
 * Minimal auth client shape used by shared state.
 */
export interface AuthClient {
  useSession: () => { data?: { user?: unknown } | null };
  listAccounts: () => Promise<{ data?: Account[] } | null>;
  accountInfo: (accountId: string) => Promise<OAuth2UserInfo | null>;
  unlinkAccount: (input: UnlinkAccountInput) => Promise<void>;
}

/**
 * Typed ORPC TanStack Query utils for the app router.
 */
export type OrpcUtils = ReturnType<
  typeof createTanstackQueryUtils<AppRouterClient>
>;
