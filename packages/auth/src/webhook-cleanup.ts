import { db } from "@kompose/db/legacy";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import type { Account } from "better-auth";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

/** Stop channels before deleting the account cascades their resource IDs away. */
export async function stopAccountWatches(
  account: Account,
  getAccessToken: () => Promise<string>
): Promise<void> {
  if (account.providerId !== "google") {
    return;
  }
  const subscriptions = await db
    .update(webhookSubscriptionTable)
    // If deletion fails after a remote stop, the next refresh must renew.
    .set({ active: false })
    .where(eq(webhookSubscriptionTable.accountId, account.id))
    .returning();
  if (subscriptions.length === 0) {
    return;
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const token = yield* Effect.tryPromise(getAccessToken);
      const client = makeGoogleCalendarService(token);
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
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.catch((error) =>
        Effect.logWarning("GOOGLE_UNLINK_WEBHOOK_CLEANUP_FAILED", {
          accountId: account.id,
          error,
        })
      )
    )
  );
}
