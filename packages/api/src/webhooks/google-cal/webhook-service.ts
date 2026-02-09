import type {
  GoogleCalendarEventsWebhookConfig,
  GoogleCalendarListWebhookConfig,
  WebhookSubscriptionSelect,
} from "@kompose/db/schema/webhook-subscription";
import { env } from "@kompose/env";
import { GoogleCalendar } from "@kompose/google-cal/client";
import { Effect } from "effect";
import { uuidv7 } from "uuidv7";
import {
  formatUnknownCause,
  WebhookProviderError,
  WebhookValidationError,
} from "../errors";
import type { LinkedAccount } from "../webhook-repository-service";
import { WebhookRepositoryService } from "../webhook-repository-service";
import {
  GOOGLE_CHANNEL_TTL_MS,
  GOOGLE_PROVIDER,
  GOOGLE_RENEWAL_BUFFER_MS,
  GOOGLE_WEBHOOK_CALLBACK_URL,
  isGoogleCalendarEventsWatchSupported,
} from "./constants";

// ── Subscription type narrowing ──────────────────────────────────────

export type GoogleCalendarListSubscription = WebhookSubscriptionSelect & {
  config: GoogleCalendarListWebhookConfig;
};

export type GoogleCalendarEventsSubscription = WebhookSubscriptionSelect & {
  config: GoogleCalendarEventsWebhookConfig;
};

// ── Private helpers ──────────────────────────────────────────────────

/** Returns true if the subscription is active and won't expire within the renewal buffer. */
function isSubscriptionActiveAndFresh(
  subscription: WebhookSubscriptionSelect
): boolean {
  const expiresAtMs = subscription.expiresAt
    ? Date.parse(subscription.expiresAt)
    : Number.NaN;

  return (
    subscription.active &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > Date.now() + GOOGLE_RENEWAL_BUFFER_MS
  );
}

/** Validates the callback URL is a public HTTPS endpoint. */
function validateCallbackUrl() {
  const callbackHost = new URL(GOOGLE_WEBHOOK_CALLBACK_URL).hostname;
  if (
    !GOOGLE_WEBHOOK_CALLBACK_URL.startsWith("https://") ||
    callbackHost === "localhost" ||
    callbackHost === "127.0.0.1"
  ) {
    return Effect.fail(
      new WebhookValidationError({
        message: `Invalid Google webhook callback URL "${GOOGLE_WEBHOOK_CALLBACK_URL}". Set NEXT_PUBLIC_WEB_URL to a public HTTPS URL.`,
      })
    );
  }
  return Effect.void;
}

/** Derives an ISO expiration string from the Google watch channel response. */
function computeExpiresAt(channelExpiration?: string): string {
  const expiresMs = channelExpiration ? Number(channelExpiration) : Number.NaN;

  return Number.isFinite(expiresMs) && expiresMs > 0
    ? new Date(expiresMs).toISOString()
    : new Date(Date.now() + GOOGLE_CHANNEL_TTL_MS).toISOString();
}

/** Detects Google's "push not supported" error for certain calendar types. */
function isPushNotSupportedError(error: WebhookProviderError): boolean {
  return (
    error.operation === "google-calendar-events-watch" &&
    (error.message.includes("pushNotSupportedForRequestedResource") ||
      error.message.includes(
        "Push notifications are not supported by this resource."
      ))
  );
}

// ── Service ──────────────────────────────────────────────────────────

export class GoogleCalendarWebhookService extends Effect.Service<GoogleCalendarWebhookService>()(
  "GoogleCalendarWebhookService",
  {
    accessors: true,
    dependencies: [WebhookRepositoryService.Default],
    effect: Effect.gen(function* () {
      const repository = yield* WebhookRepositoryService;

      // ── Shared stop-watch helper ──

      const stopWatch = Effect.fn("GoogleCalendarWebhookService.stopWatch")(
        function* (params: {
          id: string;
          operation: string;
          resourceId: string;
        }) {
          yield* Effect.annotateCurrentSpan("subscriptionId", params.id);
          yield* Effect.annotateCurrentSpan("operation", params.operation);
          yield* Effect.annotateCurrentSpan("resourceId", params.resourceId);
          const client = yield* GoogleCalendar;

          yield* client
            .stopWatch({
              channelId: params.id,
              resourceId: params.resourceId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WebhookProviderError({
                    operation: params.operation,
                    provider: GOOGLE_PROVIDER,
                    message: formatUnknownCause(cause),
                  })
              )
            );
        }
      );

      // ── Calendar list watch ──

      const refreshListWatch = Effect.fn(
        "GoogleCalendarWebhookService.refreshListWatch"
      )(function* (params: {
        account: LinkedAccount;
        existingSubscription?: GoogleCalendarListSubscription;
        userId: string;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        if (
          params.existingSubscription &&
          isSubscriptionActiveAndFresh(params.existingSubscription)
        ) {
          return;
        }

        // Stop old watch (best-effort)
        if (params.existingSubscription) {
          yield* stopWatch({
            id: params.existingSubscription.id,
            operation: "google-calendar-list-stop-watch",
            resourceId: params.existingSubscription.config.resourceId,
          }).pipe(Effect.catchTag("WebhookProviderError", () => Effect.void));
        }

        yield* validateCallbackUrl();

        const client = yield* GoogleCalendar;
        const subId = params.existingSubscription?.id ?? uuidv7();
        const expirationMs = Date.now() + GOOGLE_CHANNEL_TTL_MS;

        const channel = yield* client
          .watchCalendarList({
            address: GOOGLE_WEBHOOK_CALLBACK_URL,
            expiration: String(expirationMs),
            id: subId,
            token: env.GOOGLE_WEBHOOK_TOKEN,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WebhookProviderError({
                  operation: "google-calendar-list-watch",
                  provider: GOOGLE_PROVIDER,
                  message: formatUnknownCause(cause),
                })
            )
          );

        if (!channel.resourceId) {
          return yield* Effect.fail(
            new WebhookValidationError({
              message: "Provider watch response missing channel metadata.",
            })
          );
        }

        yield* repository.upsertSub({
          accountId: params.account.id,
          config: {
            type: "google-calendar-list",
            resourceId: channel.resourceId,
          },
          expiresAt: computeExpiresAt(channel.expiration),
          id: subId,
          provider: GOOGLE_PROVIDER,
          providerAccountId: params.account.providerAccountId,
          userId: params.userId,
          webhookToken: env.GOOGLE_WEBHOOK_TOKEN,
        });
      });

      // ── Calendar events watch ──

      const refreshEventsWatch = Effect.fn(
        "GoogleCalendarWebhookService.refreshEventsWatch"
      )(function* (params: {
        account: LinkedAccount;
        calendarId: string;
        existingSubscription?: GoogleCalendarEventsSubscription;
        userId: string;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("calendarId", params.calendarId);
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        if (!isGoogleCalendarEventsWatchSupported(params.calendarId)) {
          return;
        }

        if (
          params.existingSubscription &&
          isSubscriptionActiveAndFresh(params.existingSubscription)
        ) {
          return;
        }

        // Stop old watch (best-effort)
        if (params.existingSubscription) {
          yield* stopWatch({
            id: params.existingSubscription.id,
            operation: "google-calendar-events-stop-watch",
            resourceId: params.existingSubscription.config.resourceId,
          }).pipe(Effect.catchTag("WebhookProviderError", () => Effect.void));
        }

        yield* validateCallbackUrl();

        const client = yield* GoogleCalendar;
        const subId = params.existingSubscription?.id ?? uuidv7();
        const expirationMs = Date.now() + GOOGLE_CHANNEL_TTL_MS;

        const channel = yield* client
          .watchCalendarEvents(params.calendarId, {
            address: GOOGLE_WEBHOOK_CALLBACK_URL,
            expiration: String(expirationMs),
            id: subId,
            token: env.GOOGLE_WEBHOOK_TOKEN,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WebhookProviderError({
                  operation: "google-calendar-events-watch",
                  provider: GOOGLE_PROVIDER,
                  message: formatUnknownCause(cause),
                })
            ),
            // Certain calendar types (e.g. holidays) don't support push notifications
            Effect.catchTag("WebhookProviderError", (error) => {
              if (!isPushNotSupportedError(error)) {
                return Effect.fail(error);
              }

              // void when push not supported — nothing to persist
              return Effect.logWarning("GOOGLE_EVENTS_WEBHOOK_UNSUPPORTED", {
                accountId: params.account.id,
                calendarId: params.calendarId,
                error,
              });
            })
          );

        // void when push not supported for this calendar type — nothing to persist
        if (!channel) {
          return;
        }

        if (!channel.resourceId) {
          return yield* Effect.fail(
            new WebhookValidationError({
              message: "Provider watch response missing channel metadata.",
            })
          );
        }

        yield* repository.upsertSub({
          accountId: params.account.id,
          config: {
            type: "google-calendar-events",
            calendarId: params.calendarId,
            resourceId: channel.resourceId,
          },
          expiresAt: computeExpiresAt(channel.expiration),
          id: subId,
          provider: GOOGLE_PROVIDER,
          providerAccountId: params.account.providerAccountId,
          userId: params.userId,
          webhookToken: env.GOOGLE_WEBHOOK_TOKEN,
        });
      });

      /** Stop watching and deactivate a subscription for a calendar that was removed. */
      const deactivateEventsWatch = Effect.fn(
        "GoogleCalendarWebhookService.deactivateEventsWatch"
      )(function* (params: { subscription: GoogleCalendarEventsSubscription }) {
        yield* Effect.annotateCurrentSpan(
          "subscriptionId",
          params.subscription.id
        );
        yield* Effect.annotateCurrentSpan(
          "calendarId",
          params.subscription.config.calendarId
        );
        yield* stopWatch({
          id: params.subscription.id,
          operation: "google-calendar-events-stop-watch",
          resourceId: params.subscription.config.resourceId,
        }).pipe(Effect.catchTag("WebhookProviderError", () => Effect.void));

        yield* repository.deactivateSubById({
          id: params.subscription.id,
        });
      });

      /** List calendar IDs the user has access to, filtering unsupported ones. */
      const listCalendarIds = Effect.fn(
        "GoogleCalendarWebhookService.listCalendarIds"
      )(function* () {
        const client = yield* GoogleCalendar;

        return yield* client.listCalendarIds().pipe(
          Effect.map((calendarIds) =>
            calendarIds.filter(isGoogleCalendarEventsWatchSupported)
          ),
          Effect.mapError(
            (cause) =>
              new WebhookProviderError({
                operation: "google-calendar-events-list-calendars",
                provider: GOOGLE_PROVIDER,
                message: formatUnknownCause(cause),
              })
          )
        );
      });

      return {
        deactivateEventsWatch,
        listCalendarIds,
        refreshEventsWatch,
        refreshListWatch,
      };
    }),
  }
) {}
