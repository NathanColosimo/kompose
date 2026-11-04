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
  /** Throws on failure, like Better Auth with `throw: true`. */
  listAccounts: () => Promise<Account[]>;
  unlinkAccount: (input: UnlinkAccountInput) => Promise<void>;
}
