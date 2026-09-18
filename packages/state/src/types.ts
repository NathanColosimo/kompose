import type { AppRouterClient } from "@kompose/api/routers/index";
import type { Account, OAuth2UserInfo } from "better-auth";

export interface UnlinkAccountInput {
  /** Local Better Auth account row ID, not the provider account ID. */
  accountId: string;
}

/**
 * Minimal auth client shape used by shared state.
 */
export interface AuthClient {
  /** Select a local Better Auth account row by its ID. */
  accountInfo: (accountId: string) => Promise<OAuth2UserInfo | null>;
  listAccounts: () => Promise<{ data?: Account[] } | null>;
  unlinkAccount: (input: UnlinkAccountInput) => Promise<void>;
}

/**
 * Typed ORPC client for the app router.
 */
export type OrpcUtils = AppRouterClient;
