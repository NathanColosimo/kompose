import { auth } from "@kompose/auth";
import { Database, DatabaseLive } from "@kompose/db";
import { account } from "@kompose/db/schema/auth";
import { webhookAccountStateTable } from "@kompose/db/schema/webhook-account-state";
import type { WebhookSubscriptionSelect } from "@kompose/db/schema/webhook-subscription";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import { webhookAccountLock } from "@kompose/db/webhook-lock";
import { env } from "@kompose/env";
import {
  GoogleCalendar,
  makeGoogleCalendarService,
} from "@kompose/google-cal/client";
import type { Account } from "better-auth";
import { and, eq, gt } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID } from "../realtime/events";
import { publishToUser } from "../realtime/sync";
import { GoogleCalendarCacheService } from "../routers/google-cal/cache";
import {
  formatUnknownCause,
  WebhookAuthError,
  type WebhookProviderError,
  WebhookRepositoryError,
  WebhookValidationError,
} from "./errors";
import { GOOGLE_PROVIDER } from "./google-cal/constants";
import { UNSUPPORTED_RETRY_MS } from "./google-cal/reconciliation";
import type {
  GoogleCalendarEventsSubscription,
  GoogleCalendarListSubscription,
} from "./google-cal/webhook-service";
import {
  GoogleCalendarWebhookService,
  stopWatch,
} from "./google-cal/webhook-service";

// ── Public interfaces ────────────────────────────────────────────────

export interface RefreshAllWebhooksInput {
  accountId?: string;
  userId: string;
}

export interface HandleGoogleNotificationInput {
  headers: Headers;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isGoogleCalendarListSubscription(
  sub: WebhookSubscriptionSelect
): sub is GoogleCalendarListSubscription {
  return sub.config.type === "google-calendar-list";
}

function isGoogleCalendarEventsSubscription(
  sub: WebhookSubscriptionSelect
): sub is GoogleCalendarEventsSubscription {
  return sub.config.type === "google-calendar-events";
}

/** Keep only the most recently updated subscription when duplicates exist. */
function pickMostRecent<T extends WebhookSubscriptionSelect>(
  current: T | undefined,
  candidate: T
): T {
  if (!current) {
    return candidate;
  }

  const currentUpdatedAt = current.updatedAt
    ? Date.parse(current.updatedAt)
    : 0;
  const candidateUpdatedAt = candidate.updatedAt
    ? Date.parse(candidate.updatedAt)
    : 0;

  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

const getGoogleAccounts = (params: { accountId?: string; userId: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const conditions = [
      eq(account.userId, params.userId),
      eq(account.providerId, GOOGLE_PROVIDER),
    ];

    if (params.accountId) {
      conditions.push(eq(account.id, params.accountId));
    }

    return yield* db
      .select()
      .from(account)
      .where(and(...conditions));
  });

const listSubscriptionsForAccount = (params: {
  accountId: string;
  userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select()
      .from(webhookSubscriptionTable)
      .where(
        and(
          eq(webhookSubscriptionTable.userId, params.userId),
          eq(webhookSubscriptionTable.accountId, params.accountId)
        )
      );
  });

const findLiveSubById = (params: { id: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select()
      .from(webhookSubscriptionTable)
      .where(
        and(
          eq(webhookSubscriptionTable.id, params.id),
          eq(webhookSubscriptionTable.active, true),
          gt(webhookSubscriptionTable.expiresAt, new Date().toISOString())
        )
      )
      .limit(1);

    if (!rows[0]) {
      return yield* new WebhookRepositoryError({
        message: "No live subscription found",
        operation: "find-live-sub-by-id",
      });
    }

    return rows[0];
  });

// ── Service ──────────────────────────────────────────────────────────

export class WebhookService extends Context.Service<WebhookService>()(
  "WebhookService",
  {
    make: Effect.gen(function* () {
      const cache = yield* GoogleCalendarCacheService;
      const googleCalWebhooks = yield* GoogleCalendarWebhookService;

      /**
       * Resolve an OAuth access token for a linked Google account
       * and create a GoogleCalendar Effect client.
       * Yields WebhookAuthError when the token is unavailable (e.g. revoked).
       */
      const createGoogleClient = Effect.fn("WebhookService.createGoogleClient")(
        function* (params: { accountId: string; userId: string }) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
          yield* Effect.annotateCurrentSpan("userId", params.userId);
          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new WebhookAuthError({
                accountId: params.accountId,
                message: formatUnknownCause(cause),
              }),
            try: () =>
              auth.api.getAccessToken({
                body: {
                  accountId: params.accountId,
                  userId: params.userId,
                },
              }),
          });

          if (!result.accessToken) {
            return yield* new WebhookAuthError({
              accountId: params.accountId,
              message: "No access token available",
            });
          }

          return makeGoogleCalendarService(result.accessToken);
        }
      );

      /** Ensure all webhook subscriptions are current for a single Google account. */
      const ensureAccountWebhooks = Effect.fn(
        "WebhookService.ensureAccountWebhooks"
      )(function* (params: {
        account: Account;
        unsupportedUntil: Record<string, string>;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("userId", params.account.userId);
        const client = yield* createGoogleClient({
          accountId: params.account.id,
          userId: params.account.userId,
        });

        const accountSubs = yield* listSubscriptionsForAccount({
          accountId: params.account.id,
          userId: params.account.userId,
        });
        const activeAccountSubs = accountSubs.filter((s) => s.active);

        let existingListSub: GoogleCalendarListSubscription | undefined;
        const existingEventSubsByCalendarId = new Map<
          string,
          GoogleCalendarEventsSubscription
        >();

        for (const sub of accountSubs) {
          if (isGoogleCalendarListSubscription(sub)) {
            existingListSub = pickMostRecent(existingListSub, sub);
          } else if (isGoogleCalendarEventsSubscription(sub)) {
            const current = existingEventSubsByCalendarId.get(
              sub.config.calendarId
            );
            existingEventSubsByCalendarId.set(
              sub.config.calendarId,
              pickMostRecent(current, sub)
            );
          }
        }

        const accountWebhookProgram = Effect.gen(function* () {
          const calendarIds = yield* googleCalWebhooks.listCalendarIds();
          const calendarIdSet = new Set(calendarIds);

          const staleEventSubs = activeAccountSubs.filter(
            (s): s is GoogleCalendarEventsSubscription => {
              if (!isGoogleCalendarEventsSubscription(s)) {
                return false;
              }
              return !calendarIdSet.has(s.config.calendarId);
            }
          );

          const unsupportedUntil: Record<string, string> = {};
          const logWatchError = (error: WebhookProviderError) =>
            Effect.logWarning("GOOGLE_WEBHOOK_WATCH_FAILED", {
              accountId: params.account.id,
              error,
            }).pipe(Effect.as(undefined));
          const effects = [
            googleCalWebhooks
              .refreshListWatch({
                account: params.account,
                existingSubscription: existingListSub,
              })
              .pipe(Effect.catchTag("WebhookProviderError", logWatchError)),
            ...calendarIds.map((calendarId) =>
              googleCalWebhooks
                .refreshEventsWatch({
                  account: params.account,
                  calendarId,
                  existingSubscription:
                    existingEventSubsByCalendarId.get(calendarId),
                  unsupportedUntil: params.unsupportedUntil[calendarId],
                })
                .pipe(
                  Effect.catchTag("WebhookProviderError", logWatchError),
                  Effect.map((result) => {
                    const retryAfter = params.unsupportedUntil[calendarId];
                    if (result?.unsupported) {
                      unsupportedUntil[calendarId] = new Date(
                        Date.now() + UNSUPPORTED_RETRY_MS
                      ).toISOString();
                    } else if (
                      retryAfter &&
                      Date.parse(retryAfter) > Date.now()
                    ) {
                      unsupportedUntil[calendarId] = retryAfter;
                    }
                    return result;
                  })
                )
            ),
            ...staleEventSubs.map((subscription) =>
              googleCalWebhooks.deactivateEventsWatch({ subscription })
            ),
          ];

          // A provider failure must not roll back capability decisions or other watches.
          const results = yield* Effect.all(effects, {
            concurrency: "unbounded",
          });
          const db = yield* Database;
          yield* db
            .insert(webhookAccountStateTable)
            .values({
              accountId: params.account.id,
              unsupportedUntil,
            })
            .onConflictDoUpdate({
              target: webhookAccountStateTable.accountId,
              set: { unsupportedUntil },
            });
          return results.flatMap((result) =>
            result && "retired" in result && result.retired
              ? [result.retired]
              : []
          );
        });

        const retired = yield* accountWebhookProgram.pipe(
          Effect.provideService(GoogleCalendar, client)
        );
        return { client, retired };
      });

      /** Refresh webhook subscriptions for all (or a single) linked Google account. */
      const refreshAll = Effect.fn("WebhookService.refreshAll")(function* (
        params: RefreshAllWebhooksInput
      ) {
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        if (params.accountId) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
        }
        const accounts = yield* getGoogleAccounts({
          accountId: params.accountId,
          userId: params.userId,
        });
        const db = yield* Database;

        if (accounts.length === 0) {
          return;
        }

        // Process each account independently so one failure (e.g. revoked token)
        // doesn't prevent other accounts from being refreshed.
        yield* Effect.forEach(
          accounts,
          (acct) =>
            db
              .transaction(() =>
                Effect.gen(function* () {
                  yield* db.execute(webhookAccountLock(acct.id));
                  // Re-read under the lock: unlink may have completed while we waited.
                  const [linkedAccount] = yield* getGoogleAccounts({
                    accountId: acct.id,
                    userId: params.userId,
                  });
                  if (!linkedAccount) {
                    return;
                  }
                  const [state] = yield* db
                    .select()
                    .from(webhookAccountStateTable)
                    .where(eq(webhookAccountStateTable.accountId, acct.id));
                  if (
                    state?.unlinkingUntil &&
                    Date.parse(state.unlinkingUntil) > Date.now()
                  ) {
                    return;
                  }
                  return yield* ensureAccountWebhooks({
                    account: linkedAccount,
                    unsupportedUntil: state?.unsupportedUntil ?? {},
                  });
                })
              )
              .pipe(
                // Remote stops must happen after commit: a rollback keeps old rows live.
                Effect.flatMap((result) =>
                  result
                    ? Effect.forEach(
                        result.retired,
                        (sub) =>
                          stopWatch({
                            id: sub.id,
                            operation: "google-calendar-retire-watch",
                            resourceId: sub.config.resourceId,
                          }),
                        { concurrency: "unbounded", discard: true }
                      ).pipe(
                        Effect.provideService(GoogleCalendar, result.client)
                      )
                    : Effect.void
                ),
                Effect.tapError((error) =>
                  Effect.logWarning("WEBHOOK_ACCOUNT_SETUP_FAILED", {
                    accountId: acct.id,
                    error,
                  })
                ),
                Effect.catch(() => Effect.void)
              ),
          { concurrency: "unbounded", discard: true }
        );
      });

      /**
       * Process an incoming Google push notification webhook.
       * Yields WebhookValidationError for invalid headers/token.
       * Yields WebhookRepositoryError if subscription is not found.
       */
      const handleGoogleNotification = Effect.fn(
        "WebhookService.handleGoogleNotification"
      )(function* (params: HandleGoogleNotificationInput) {
        const channelId = params.headers.get("x-goog-channel-id");
        const channelToken = params.headers.get("x-goog-channel-token");
        const resourceId = params.headers.get("x-goog-resource-id");
        const resourceState = params.headers.get("x-goog-resource-state");

        // Annotate span with extracted webhook header values
        if (channelId) {
          yield* Effect.annotateCurrentSpan("channelId", channelId);
        }
        if (resourceId) {
          yield* Effect.annotateCurrentSpan("resourceId", resourceId);
        }
        if (resourceState) {
          yield* Effect.annotateCurrentSpan("resourceState", resourceState);
        }

        if (!(channelId && resourceId)) {
          return yield* new WebhookValidationError({
            message: "Missing required Google channel headers",
          });
        }

        if (channelToken !== env.GOOGLE_WEBHOOK_TOKEN) {
          return yield* new WebhookValidationError({
            message: "Invalid Google channel token",
          });
        }

        const subscription = yield* findLiveSubById({
          id: channelId,
        });

        // Stale notification for an old resource — acknowledge but nothing to do
        if (subscription.config.resourceId !== resourceId) {
          yield* Effect.log("WEBHOOK_STALE_RESOURCE_SKIPPED", {
            accountId: subscription.accountId,
            actualResourceId: resourceId,
            expectedResourceId: subscription.config.resourceId,
            userId: subscription.userId,
          });
          return {};
        }

        // Google sends an initial "sync" notification when a watch is first created
        if (!(resourceState && resourceState !== "sync")) {
          yield* Effect.log("WEBHOOK_SYNC_NOTIFICATION_ACKNOWLEDGED", {
            accountId: subscription.accountId,
            userId: subscription.userId,
          });
          return {};
        }

        // Publish realtime event to the user's SSE channel
        if (isGoogleCalendarListSubscription(subscription)) {
          yield* Effect.log("WEBHOOK_CALENDAR_LIST_CHANGED", {
            accountId: subscription.accountId,
            providerAccountId: subscription.providerAccountId,
            userId: subscription.userId,
          });

          // Use the subscription's exact linkage, including its local account row ID.
          yield* cache.invalidateCalendars({
            accountId: subscription.providerAccountId,
            id: subscription.accountId,
            userId: subscription.userId,
          });

          yield* publishToUser(subscription.userId, {
            payload: {
              accountId: subscription.providerAccountId,
              calendarId: GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID,
            },
            type: "google-calendar",
          });

          return {
            followUpRefresh: {
              accountId: subscription.accountId,
              userId: subscription.userId,
            },
          };
        }

        if (isGoogleCalendarEventsSubscription(subscription)) {
          yield* Effect.log("WEBHOOK_CALENDAR_EVENTS_CHANGED", {
            accountId: subscription.accountId,
            calendarId: subscription.config.calendarId,
            providerAccountId: subscription.providerAccountId,
            userId: subscription.userId,
          });

          yield* cache.invalidateEvents(
            {
              accountId: subscription.providerAccountId,
              id: subscription.accountId,
              userId: subscription.userId,
            },
            subscription.config.calendarId
          );

          yield* publishToUser(subscription.userId, {
            payload: {
              accountId: subscription.providerAccountId,
              calendarId: subscription.config.calendarId,
            },
            type: "google-calendar",
          });
        }

        return {};
      });

      return {
        handleGoogleNotification,
        refreshAll,
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(
      Layer.mergeAll(
        DatabaseLive,
        GoogleCalendarCacheService.layer,
        GoogleCalendarWebhookService.layer
      )
    )
  );
}
