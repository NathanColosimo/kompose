import { db } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { eq } from "drizzle-orm";
import { getAccountInfo } from "./account-info";

export interface LinkedAccountWithProfile {
  accountId: string;
  email: string;
  id: string;
  image: string | null;
  name: string;
  providerId: string;
}

/**
 * Resolve linked auth accounts and enrich them with provider profile metadata.
 * This keeps account/profile shaping in one place for both account routes and bootstrap.
 */
export async function listLinkedAccountsWithProfile(
  userId: string
): Promise<LinkedAccountWithProfile[]> {
  const accounts = await db
    .select()
    .from(accountTable)
    .where(eq(accountTable.userId, userId));

  return await Promise.all(
    accounts.map(async (account) => {
      const info = await getAccountInfo({
        accountId: account.accountId,
        userId,
      });

      return {
        id: account.id,
        accountId: account.accountId,
        providerId: account.providerId,
        email: info.email,
        name: info.name,
        image: info.image,
      };
    })
  );
}
