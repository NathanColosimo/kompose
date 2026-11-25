import { Database } from "@kompose/db";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import { getPluginForProvider, type PluginId } from "@kompose/plugins";
import { createWhoopClient } from "@kompose/whoop/client";
import type { Account } from "better-auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { authRuntime } from "./runtime";

/**
 * What a plugin tells its provider before one of its accounts is unlinked.
 * `accessToken` asks for the account's token only when it is used.
 */
type UnlinkCleanup = (
  account: Account,
  accessToken: Effect.Effect<string, unknown>
) => Effect.Effect<void, unknown, Database>;

/** Stop channels before deleting the account cascades their resource IDs away. */
const stopGoogleWatches: UnlinkCleanup = (account, accessToken) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const subscriptions = yield* db
      .update(webhookSubscriptionTable)
      // If deletion fails after a remote stop, the next refresh must renew.
      .set({ active: false })
      .where(eq(webhookSubscriptionTable.accountId, account.id))
      .returning();
    if (subscriptions.length === 0) {
      return;
    }
    const client = makeGoogleCalendarService(yield* accessToken);
    yield* Effect.forEach(
      subscriptions,
      (sub) =>
        client
          .stopWatch({
            channelId: sub.id,
            resourceId: sub.config.resourceId,
          })
          .pipe(Effect.ignore),
      { concurrency: "unbounded", discard: true }
    );
  });

/**
 * WHOOP asks apps to revoke a user's access when they disable the
 * integration. It also stops WHOOP's webhook calls for that user.
 */
const revokeWhoopAccess: UnlinkCleanup = (_account, accessToken) =>
  accessToken.pipe(
    Effect.flatMap((token) => createWhoopClient(token).revokeAccess())
  );

/** The cleanup of each plugin that has one. A new plugin's goes here. */
const unlinkCleanups = new Map<PluginId, UnlinkCleanup>([
  ["google-calendar", stopGoogleWatches],
  ["whoop", revokeWhoopAccess],
]);

/**
 * Runs the plugin's cleanup for an account that is about to be unlinked,
 * from the `account.delete.before` hook, while its token still exists. A
 * cleanup that fails or takes too long is logged, and the unlink goes on.
 * See documents/plugins.md.
 */
export async function cleanUpBeforeUnlink(
  account: Account,
  getAccessToken: () => Promise<string>
): Promise<void> {
  const plugin = getPluginForProvider(account.providerId);
  const cleanup = plugin && unlinkCleanups.get(plugin.id);
  if (!cleanup) {
    return;
  }
  await authRuntime.runPromise(
    cleanup(account, Effect.tryPromise(getAccessToken)).pipe(
      Effect.timeout("10 seconds"),
      Effect.catch((error) =>
        Effect.logWarning("PLUGIN_UNLINK_CLEANUP_FAILED", {
          accountId: account.id,
          error,
          pluginId: plugin.id,
        })
      )
    )
  );
}
