import { db } from "@kompose/db/legacy";
import { connectionTable } from "@kompose/db/schema/connection";
import { getPluginForProvider } from "@kompose/plugins";
import type { Account } from "better-auth";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

/**
 * Linking an account from a plugin's OAuth provider connects that plugin.
 * Unlinking deletes the account row, and the connection with it (cascade).
 */
export async function connectLinkedAccount(account: Account): Promise<void> {
  const plugin = getPluginForProvider(account.providerId);
  if (!plugin) {
    return;
  }
  await db
    .insert(connectionTable)
    .values({
      accountId: account.id,
      id: uuidv7(),
      pluginId: plugin.id,
      userId: account.userId,
    })
    .onConflictDoNothing();
}

/**
 * Better Auth updates the account with fresh tokens when the user connects it
 * again, which is how a `needs-reauth` connection recovers.
 */
export async function reactivateConnection(account: Account): Promise<void> {
  await db
    .update(connectionTable)
    .set({ status: "active" })
    .where(eq(connectionTable.accountId, account.id));
}
