import { Database, DatabaseLive, runtimeMemoMap } from "@kompose/db";
import { webhookAccountStateTable } from "@kompose/db/schema/webhook-account-state";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import { webhookAccountLock } from "@kompose/db/webhook-lock";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import type { Account } from "better-auth";
import { eq, sql } from "drizzle-orm";
import { Effect, ManagedRuntime, Schema } from "effect";

class WebhookCleanupTokenError extends Schema.TaggedError<WebhookCleanupTokenError>()(
  "WebhookCleanupTokenError",
  { cause: Schema.Unknown }
) {}

const UNLINK_GRACE_MS = 60_000;

const webhookCleanupRuntime = ManagedRuntime.make(DatabaseLive, {
  memoMap: runtimeMemoMap,
});

/** Run before Better Auth deletes the account and cascades its channel rows. */
export function stopAccountWatches(
  account: Account,
  getAccessToken: () => Promise<string>
): Promise<void> {
  if (account.providerId !== "google") {
    return Promise.resolve();
  }
  return webhookCleanupRuntime.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const subscriptions = yield* db.transaction(() =>
        Effect.gen(function* () {
          // Bound the wait for a reconcile holding the lock (its Google calls can
          // retry for minutes). On timeout the unlink fails and nothing changes.
          yield* db.execute(sql`set local lock_timeout = '15s'`);
          yield* db.execute(webhookAccountLock(account.id));
          // A reconcile already in flight finishes first. Later ones see unlink intent.
          const unlinkingUntil = new Date(
            Date.now() + UNLINK_GRACE_MS
          ).toISOString();
          yield* db
            .insert(webhookAccountStateTable)
            .values({ accountId: account.id, unlinkingUntil })
            .onConflictDoUpdate({
              set: { unlinkingUntil },
              target: webhookAccountStateTable.accountId,
            });
          return yield* db
            .update(webhookSubscriptionTable)
            // A stop can succeed remotely even if its response times out. If
            // deletion fails, none of these channels can be assumed live.
            .set({ active: false })
            .where(eq(webhookSubscriptionTable.accountId, account.id))
            .returning();
        })
      );
      if (subscriptions.length === 0) {
        return;
      }
      yield* Effect.gen(function* () {
        const token = yield* Effect.tryPromise({
          catch: (cause) => new WebhookCleanupTokenError({ cause }),
          try: getAccessToken,
        });
        if (!token) {
          return yield* new WebhookCleanupTokenError({
            cause: new Error("No Google access token available"),
          });
        }
        const client = makeGoogleCalendarService(token);
        yield* Effect.forEach(
          subscriptions,
          (sub) =>
            client
              .stopWatch({
                channelId: sub.id,
                resourceId: sub.config.resourceId,
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("GOOGLE_UNLINK_CHANNEL_STOP_FAILED", {
                    accountId: account.id,
                    error,
                    subscriptionId: sub.id,
                  })
                )
              ),
          { concurrency: 5, discard: true }
        );
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.catch((error) =>
          Effect.logWarning("GOOGLE_UNLINK_WEBHOOK_CLEANUP_FAILED", {
            accountId: account.id,
            error,
          })
        )
      );
    }).pipe(Effect.withSpan("Auth.stopAccountWatches"))
  );
}
