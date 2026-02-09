import { db } from "@kompose/db";
import { account } from "@kompose/db/schema/auth";
import {
  type WebhookSubscriptionInsert,
  type WebhookSubscriptionProvider,
  webhookSubscriptionTable,
} from "@kompose/db/schema/webhook-subscription";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { formatUnknownCause, WebhookRepositoryError } from "./errors";

// ── Types ────────────────────────────────────────────────────────────

/** A linked OAuth account for a given provider. */
export interface LinkedAccount {
  /** Internal account ID (Better Auth's account.id). */
  id: string;
  /** External provider account ID (e.g. Google account ID). */
  providerAccountId: string;
}

// ── Service ──────────────────────────────────────────────────────────

export class WebhookRepositoryService extends Effect.Service<WebhookRepositoryService>()(
  "WebhookRepositoryService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      /** List OAuth accounts for a user by provider, optionally filtered by accountId. */
      const getAccountsByProvider = Effect.fn(
        "WebhookRepositoryService.getAccountsByProvider"
      )(function* (params: {
        accountId?: string;
        providerId: string;
        userId: string;
      }) {
        return yield* Effect.tryPromise({
          try: () => {
            const conditions = [
              eq(account.userId, params.userId),
              eq(account.providerId, params.providerId),
            ];

            if (params.accountId) {
              conditions.push(eq(account.id, params.accountId));
            }

            return db
              .select({
                id: account.id,
                providerAccountId: account.accountId,
              })
              .from(account)
              .where(and(...conditions));
          },
          catch: (cause) =>
            new WebhookRepositoryError({
              operation: "get-accounts-by-provider",
              message: formatUnknownCause(cause),
            }),
        });
      });

      /** List webhook subscriptions for a user, optionally filtered by provider. */
      const listSubscriptionsForUser = Effect.fn(
        "WebhookRepositoryService.listSubscriptionsForUser"
      )(function* (params: {
        provider?: WebhookSubscriptionProvider;
        userId: string;
      }) {
        return yield* Effect.tryPromise({
          try: () => {
            const conditions = [
              eq(webhookSubscriptionTable.userId, params.userId),
            ];

            if (params.provider) {
              conditions.push(
                eq(webhookSubscriptionTable.provider, params.provider)
              );
            }

            return db
              .select()
              .from(webhookSubscriptionTable)
              .where(and(...conditions));
          },
          catch: (cause) =>
            new WebhookRepositoryError({
              operation: "list-subscriptions-for-user",
              message: formatUnknownCause(cause),
            }),
        });
      });

      /**
       * Find an active subscription by its ID (primary key).
       * Yields WebhookRepositoryError if no active subscription exists.
       */
      const findActiveSubById = Effect.fn(
        "WebhookRepositoryService.findActiveSubById"
      )(function* (params: { id: string }) {
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(webhookSubscriptionTable)
              .where(
                and(
                  eq(webhookSubscriptionTable.id, params.id),
                  eq(webhookSubscriptionTable.active, true)
                )
              )
              .limit(1),
          catch: (cause) =>
            new WebhookRepositoryError({
              operation: "find-active-sub-by-id",
              message: formatUnknownCause(cause),
            }),
        });

        if (!rows[0]) {
          return yield* new WebhookRepositoryError({
            operation: "find-active-sub-by-id",
            message: "No active subscription found",
          });
        }

        return rows[0];
      });

      /** Update the lastNotifiedAt timestamp for a subscription. */
      const touchSubById = Effect.fn("WebhookRepositoryService.touchSubById")(
        function* (params: { id: string; nowIso: string }) {
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(webhookSubscriptionTable)
                .set({ lastNotifiedAt: params.nowIso })
                .where(eq(webhookSubscriptionTable.id, params.id)),
            catch: (cause) =>
              new WebhookRepositoryError({
                operation: "touch-sub-by-id",
                message: formatUnknownCause(cause),
              }),
          });
        }
      );

      /** Upsert a webhook subscription using the primary key (id) as conflict target. */
      const upsertSub = Effect.fn("WebhookRepositoryService.upsertSub")(
        function* (values: WebhookSubscriptionInsert) {
          yield* Effect.tryPromise({
            try: () =>
              db
                .insert(webhookSubscriptionTable)
                .values(values)
                .onConflictDoUpdate({
                  target: webhookSubscriptionTable.id,
                  set: {
                    active: values.active ?? true,
                    config: values.config,
                    expiresAt: values.expiresAt,
                    lastNotifiedAt: values.lastNotifiedAt,
                    providerAccountId: values.providerAccountId,
                    updatedAt: new Date().toISOString(),
                    webhookToken: values.webhookToken,
                  },
                }),
            catch: (cause) =>
              new WebhookRepositoryError({
                operation: "upsert-sub",
                message: formatUnknownCause(cause),
              }),
          });
        }
      );

      /** Mark a subscription as inactive. */
      const deactivateSubById = Effect.fn(
        "WebhookRepositoryService.deactivateSubById"
      )(function* (params: { id: string }) {
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(webhookSubscriptionTable)
              .set({ active: false })
              .where(eq(webhookSubscriptionTable.id, params.id)),
          catch: (cause) =>
            new WebhookRepositoryError({
              operation: "deactivate-sub-by-id",
              message: formatUnknownCause(cause),
            }),
        });
      });

      return {
        deactivateSubById,
        findActiveSubById,
        getAccountsByProvider,
        listSubscriptionsForUser,
        touchSubById,
        upsertSub,
      };
    }),
  }
) {}
