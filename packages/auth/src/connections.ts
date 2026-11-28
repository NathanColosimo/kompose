import { db } from "@kompose/db/legacy";
import { connectionTable } from "@kompose/db/schema/connection";
import { getPluginForProvider } from "@kompose/plugins";
import type { Account } from "better-auth";
import { getOAuthState } from "better-auth/api";
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
      // Google sends a refresh token only with its consent screen, which a
      // sign-in skips when the user has already granted access. Without one,
      // the account stops working when its access token expires.
      status: account.refreshToken ? "active" : "needs-reauth",
      userId: account.userId,
    })
    .onConflictDoNothing();
}

/**
 * A `needs-reauth` connection recovers when the user links the account again
 * (Reconnect), which always returns a new refresh token. A Google sign-in also
 * updates the account, but can leave the refresh token that stopped working.
 */
export async function reactivateConnection(account: Account): Promise<void> {
  const oauthState = await getOAuthState();
  if (!oauthState?.link) {
    return;
  }
  await db
    .update(connectionTable)
    .set({ status: "active" })
    .where(eq(connectionTable.accountId, account.id));
}
