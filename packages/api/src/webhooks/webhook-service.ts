import { auth } from "@kompose/auth";
import type { WebhookSubscriptionSelect } from "@kompose/db/schema/webhook-subscription";
import { GoogleCalendar, GoogleCalendarLive } from "@kompose/google-cal/client";
import { Effect } from "effect";
import { GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID } from "../realtime/events";
import { publishToUserBestEffort } from "../realtime/sync";
import type { WebhookProviderError, WebhookRepositoryError } from "./errors";
import {
  formatUnknownCause,
  WebhookAuthError,
  WebhookValidationError,
} from "./errors";
import { GOOGLE_PROVIDER } from "./google-cal/constants";
import type {
  GoogleCalendarEventsSubscription,
  GoogleCalendarListSubscription,
} from "./google-cal/webhook-service";
import { GoogleCalendarWebhookService } from "./google-cal/webhook-service";
import type { LinkedAccount } from "./webhook-repository-service";
import { WebhookRepositoryService } from "./webhook-repository-service";
import { env } from "@kompose/env";

// ── Public interfaces ────────────────────────────────────────────────

export interface RefreshAllWebhooksInput {
  accountId?: string;
  userId: string;
}

export interface HandleGoogleNotificationInput {
  headers: Headers;
}

export interface HandleGoogleNotificationResult {
  followUpRefresh?: {
    accountId: string;
    userId: string;
  };
}

export type WebhookServiceError =
  | WebhookAuthError
  | WebhookProviderError
  | WebhookRepositoryError
  | WebhookValidationError;

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

// ── Service ──────────────────────────────────────────────────────────

export class WebhookService extends Effect.Service<WebhookService>()(
  "WebhookService",
  {
    accessors: true,
    dependencies: [
      GoogleCalendarWebhookService.Default,
      WebhookRepositoryService.Default,
    ],
    effect: Effect.gen(function* () {
      const googleCalWebhooks = yield* GoogleCalendarWebhookService;
      const repository = yield* WebhookRepositoryService;

      /**
       * Resolve an OAuth access token for a linked Google account
       * and create a GoogleCalendar Effect client.
       * Yields WebhookAuthError when the token is unavailable (e.g. revoked).
       */
      const createGoogleClient = Effect.fn("WebhookService.createGoogleClient")(
        function* (params: { accountId: string; userId: string }) {
          const result = yield* Effect.tryPromise({
            try: () =>
              auth.api.getAccessToken({
                body: {
                  accountId: params.accountId,
                  providerId: GOOGLE_PROVIDER,
                  userId: params.userId,
                },
              }),
            catch: (cause) =>
              new WebhookAuthError({
                accountId: params.accountId,
                message: formatUnknownCause(cause),
              }),
          });

          if (!result.accessToken) {
            return yield* new WebhookAuthError({
              accountId: params.accountId,
              message: "No access token available",
            });
          }

          return yield* GoogleCalendar.pipe(
            Effect.provide(GoogleCalendarLive(result.accessToken))
          );
        }
      );

      /** Ensure all webhook subscriptions are current for a single Google account. */
      const ensureAccountWebhooks = Effect.fn(
        "WebhookService.ensureAccountWebhooks"
      )(function* (params: {
        account: LinkedAccount;
        existingSubscriptions: WebhookSubscriptionSelect[];
        userId: string;
      }) {
        const client = yield* createGoogleClient({
          accountId: params.account.id,
          userId: params.userId,
        });

        // Partition existing subscriptions for this account
        const accountSubs = params.existingSubscriptions.filter(
          (s) => s.accountId === params.account.id && s.active
        );

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
          const staleEventSubs = accountSubs.filter(
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

          if (effects.length > 0) {
            yield* Effect.all(effects, {
              concurrency: "unbounded",
              discard: true,
            });
          }
        });

        yield* accountWebhookProgram.pipe(
          Effect.provideService(GoogleCalendar, client)
        );
      });

      /** Refresh webhook subscriptions for all (or a single) linked Google account. */
      const refreshAll = Effect.fn("WebhookService.refreshAll")(function* (
        params: RefreshAllWebhooksInput
      ) {
        const accounts = yield* repository.getAccountsByProvider({
          accountId: params.accountId,
          providerId: GOOGLE_PROVIDER,
          userId: params.userId,
        });

        if (accounts.length === 0) {
          return;
        }

        const existingSubscriptions =
          yield* repository.listSubscriptionsForUser({
            provider: GOOGLE_PROVIDER,
            userId: params.userId,
          });

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
              Effect.catchAll(() => Effect.void)
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

        const subscription = yield* repository.findActiveSubById({
          id: channelId,
        });

        // Stale notification for an old resource — acknowledge but nothing to do
        if (subscription.config.resourceId !== resourceId) {
          return {};
        }

        yield* repository.touchSubById({
          id: channelId,
          nowIso: new Date().toISOString(),
        });

        // Google sends an initial "sync" notification when a watch is first created
        if (!(resourceState && resourceState !== "sync")) {
          return {};
        }

        // Publish realtime event to the user's SSE channel
        if (isGoogleCalendarListSubscription(subscription)) {
          publishToUserBestEffort(subscription.userId, {
            type: "google-calendar",
            payload: {
              accountId: subscription.accountId,
              calendarId: GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID,
            },
          });

          return {
            followUpRefresh: {
              accountId: subscription.accountId,
              userId: subscription.userId,
            },
          };
        }

        if (isGoogleCalendarEventsSubscription(subscription)) {
          publishToUserBestEffort(subscription.userId, {
            type: "google-calendar",
            payload: {
              accountId: subscription.accountId,
              calendarId: subscription.config.calendarId,
            },
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
) {}
