import { db } from "@kompose/db/legacy";
import { account } from "@kompose/db/schema/auth";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

/**
 * App APIs and calendar caches use provider account IDs. Better Auth's account
 * selectors use local row IDs, so resolve the owned row at that boundary.
 */
export async function getLinkedAccountId(params: {
  providerAccountId: string;
  providerId: "google" | "whoop";
  userId: string;
}): Promise<string> {
  const linkedAccounts = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.accountId, params.providerAccountId),
        eq(account.providerId, params.providerId),
        eq(account.userId, params.userId)
      )
    )
    .limit(2);

  const [linkedAccount] = linkedAccounts;
  if (!linkedAccount || linkedAccounts.length !== 1) {
    throw new APIError("BAD_REQUEST", {
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found",
    });
  }

  return linkedAccount.id;
}
