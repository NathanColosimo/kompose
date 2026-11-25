import type { Account } from "better-auth";

export interface UnlinkAccountInput {
  /** Local Better Auth account row ID, not the provider account ID. */
  accountId: string;
}

export interface AuthClient {
  /** Throws on failure, like Better Auth with `throw: true`. */
  listAccounts: () => Promise<Account[]>;
  unlinkAccount: (input: UnlinkAccountInput) => Promise<void>;
}
