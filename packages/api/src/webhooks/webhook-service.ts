import { auth } from "@kompose/auth";
import { Database, DatabaseLive } from "@kompose/db";
import { account } from "@kompose/db/schema/auth";
import type { WebhookSubscriptionSelect } from "@kompose/db/schema/webhook-subscription";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import {
  GoogleCalendar,
  makeGoogleCalendarService,
} from "@kompose/google-cal/client";
import type { Account } from "better-auth";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID } from "../realtime/events";
import { publishToUser } from "../realtime/sync";
import { GoogleCalendarCacheService } from "../routers/google-cal/cache";
import {
  formatUnknownCause,
  WebhookAuthError,
  WebhookRepositoryError,
} from "./errors";
import { GOOGLE_PROVIDER } from "./google-cal/constants";
import type {
  GoogleCalendarEventsSubscription,
  GoogleCalendarListSubscription,
} from "./google-cal/webhook-service";
import { GoogleCalendarWebhookService } from "./google-cal/webhook-service";

// ── Public interfaces ────────────────────────────────────────────────

export interface RefreshAllWebhooksInput {
  accountId?: string;
  userId: string;
}

/** The `X-Goog-*` headers of a push notification, already checked. */
interface GoogleChannelNotification {
  channelId: string;
  resourceId: string;
  resourceState: string | null;
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

const listGoogleSubscriptions = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select()
      .from(webhookSubscriptionTable)
      .where(
        and(
          eq(webhookSubscriptionTable.userId, userId),
          eq(webhookSubscriptionTable.provider, GOOGLE_PROVIDER)
        )
      );
  });

const findActiveSubById = (params: { id: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select()
      .from(webhookSubscriptionTable)
      .where(
        and(
          eq(webhookSubscriptionTable.id, params.id),
          eq(webhookSubscriptionTable.active, true)
        )
      )
      .limit(1);

    if (!rows[0]) {
      return yield* new WebhookRepositoryError({
        message: "No active subscription found",
        operation: "find-active-sub-by-id",
      });
    }

    return rows[0];
  });

const touchSubById = (params: { id: string; nowIso: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .update(webhookSubscriptionTable)
      .set({ lastNotifiedAt: params.nowIso })
      .where(eq(webhookSubscriptionTable.id, params.id));
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
        existingSubscriptions: WebhookSubscriptionSelect[];
        userId: string;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        const client = yield* createGoogleClient({
          accountId: params.account.id,
          userId: params.userId,
        });

        // Partition existing subscriptions for this account
        const accountSubs = params.existingSubscriptions.filter(
          (s) => s.accountId === params.account.id
        );
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

        // Run all watches concurrently, provided with the account's Google client
        const accountWebhookProgram = Effect.gen(function* () {
          const calendarIds = yield* googleCalWebhooks.listCalendarIds();
          const calendarIdSet = new Set(calendarIds);

          // Identify stale event subscriptions for calendars no longer in the user's list
          const staleEventSubs = activeAccountSubs.filter(
            (s): s is GoogleCalendarEventsSubscription => {
              if (!isGoogleCalendarEventsSubscription(s)) {
                return false;
              }
              return !calendarIdSet.has(s.config.calendarId);
            }
          );

          const effects = [
            googleCalWebhooks.refreshListWatch({
              account: params.account,
              existingSubscription: existingListSub,
              userId: params.userId,
            }),
            ...calendarIds.map((calendarId) =>
              googleCalWebhooks.refreshEventsWatch({
                account: params.account,
                calendarId,
                existingSubscription:
                  existingEventSubsByCalendarId.get(calendarId),
                userId: params.userId,
              })
            ),
            ...staleEventSubs.map((subscription) =>
              googleCalWebhooks.deactivateEventsWatch({ subscription })
            ),
          ];

          yield* Effect.all(effects, {
            concurrency: "unbounded",
            discard: true,
          });
        });

        yield* accountWebhookProgram.pipe(
          Effect.provideService(GoogleCalendar, client)
        );
      });

      /** Refresh webhook subscriptions for all (or a single) linked Google account. */
      const refreshAll = Effect.fn("WebhookService.refreshAll")(function* (
        params: RefreshAllWebhooksInput
      ) {
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        if (params.accountId) {
          yield* Effect.annotateCurrentSpan("accountId", params.accountId);
        }
        // Independent lookups; both only need the user id.
        const [accounts, existingSubscriptions] = yield* Effect.all(
          [
            getGoogleAccounts({
              accountId: params.accountId,
              userId: params.userId,
            }),
            listGoogleSubscriptions(params.userId),
          ],
          { concurrency: "unbounded" }
        );

        if (accounts.length === 0) {
          return;
        }

        // Process each account independently so one failure (e.g. revoked token)
        // doesn't prevent other accounts from being refreshed.
        yield* Effect.forEach(
          accounts,
          (acct) =>
            ensureAccountWebhooks({
              account: acct,
              existingSubscriptions,
              userId: params.userId,
            }).pipe(
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
       * Process a Google push notification whose headers were checked.
       * Yields WebhookRepositoryError if subscription is not found.
       */
      const handleGoogleNotification = Effect.fn(
        "WebhookService.handleGoogleNotification"
      )(function* ({
        channelId,
        resourceId,
        resourceState,
      }: GoogleChannelNotification) {
        yield* Effect.annotateCurrentSpan("channelId", channelId);
        yield* Effect.annotateCurrentSpan("resourceId", resourceId);
        if (resourceState) {
          yield* Effect.annotateCurrentSpan("resourceState", resourceState);
        }

        const subscription = yield* findActiveSubById({
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

        yield* touchSubById({
          id: channelId,
          nowIso: new Date().toISOString(),
        });

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

          // Cache keys and client query keys use Google's provider account id.
          yield* cache.invalidateCalendars(
            subscription.userId,
            subscription.providerAccountId
          );

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

          // Invalidate all cached events for this calendar (best effort).
          // Webhooks don't tell us which event changed, so we clear everything.
          yield* cache.invalidateAllEvents(
            subscription.userId,
            subscription.providerAccountId,
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
