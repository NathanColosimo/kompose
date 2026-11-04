import { Database, DatabaseLive } from "@kompose/db";
import type {
  GoogleCalendarEventsWebhookConfig,
  GoogleCalendarListWebhookConfig,
  WebhookSubscriptionInsert,
  WebhookSubscriptionSelect,
} from "@kompose/db/schema/webhook-subscription";
import { webhookSubscriptionTable } from "@kompose/db/schema/webhook-subscription";
import { env } from "@kompose/env";
import {
  GoogleCalendar,
  type GoogleCalendarService,
} from "@kompose/google-cal/client";
import type { Account } from "better-auth";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
import {
  formatUnknownCause,
  WebhookProviderError,
  WebhookValidationError,
} from "../errors";
import {
  GOOGLE_CHANNEL_TTL_MS,
  GOOGLE_PROVIDER,
  GOOGLE_RENEWAL_BUFFER_MS,
  GOOGLE_WEBHOOK_CALLBACK_URL,
  isGoogleHolidayCalendarId,
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

function toProviderError(operation: string) {
  return (cause: unknown) =>
    new WebhookProviderError({
      message: formatUnknownCause(cause),
      operation,
      provider: GOOGLE_PROVIDER,
    });
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

const upsertSub = (values: WebhookSubscriptionInsert) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .insert(webhookSubscriptionTable)
      .values(values)
      .onConflictDoUpdate({
        set: {
          active: values.active ?? true,
          config: values.config,
          expiresAt: values.expiresAt,
          lastNotifiedAt: values.lastNotifiedAt,
          providerAccountId: values.providerAccountId,
          updatedAt: new Date().toISOString(),
          webhookToken: values.webhookToken,
        },
        target: webhookSubscriptionTable.id,
      });
  });

const deactivateSubById = (params: { id: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .update(webhookSubscriptionTable)
      .set({ active: false })
      .where(eq(webhookSubscriptionTable.id, params.id));
  });

/** Stop a watch channel. Best effort: a failure is ignored (it still shows on the span). */
const stopWatch = (params: {
  id: string;
  operation: string;
  resourceId: string;
}) =>
  Effect.gen(function* () {
    const client = yield* GoogleCalendar;
    yield* client.stopWatch({
      channelId: params.id,
      resourceId: params.resourceId,
    });
  }).pipe(
    Effect.withSpan("GoogleCalendarWebhookService.stopWatch", {
      attributes: {
        operation: params.operation,
        resourceId: params.resourceId,
        subscriptionId: params.id,
      },
    }),
    Effect.ignore
  );

type WatchChannelInput = Parameters<
  GoogleCalendarService["watchCalendarList"]
>[0];
type WatchChannel = Effect.Success<
  ReturnType<GoogleCalendarService["watchCalendarList"]>
>;

/**
 * Keep one watch channel current. Does nothing while the existing channel is
 * active and fresh. Otherwise stops it (best effort), opens a new channel
 * with `watch` under the same subscription ID, and saves it. `watch` returns
 * undefined when the resource doesn't support push.
 */
const renewWatch = <E, R>(params: {
  account: Account;
  config: (resourceId: string) => WebhookSubscriptionInsert["config"];
  existingSubscription:
    | GoogleCalendarListSubscription
    | GoogleCalendarEventsSubscription
    | undefined;
  stopOperation: string;
  userId: string;
  watch: (
    channel: WatchChannelInput
  ) => Effect.Effect<WatchChannel | undefined, E, R>;
}) =>
  Effect.gen(function* () {
    const existing = params.existingSubscription;
    if (existing && isSubscriptionActiveAndFresh(existing)) {
      return;
    }

    if (existing?.active) {
      yield* stopWatch({
        id: existing.id,
        operation: params.stopOperation,
        resourceId: existing.config.resourceId,
      });
    }

    yield* validateCallbackUrl();

    const subId = existing?.id ?? uuidv7();
    const channel = yield* params.watch({
      address: GOOGLE_WEBHOOK_CALLBACK_URL,
      expiration: String(Date.now() + GOOGLE_CHANNEL_TTL_MS),
      id: subId,
      token: env.GOOGLE_WEBHOOK_TOKEN,
    });
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

    yield* upsertSub({
      accountId: params.account.id,
      config: params.config(channel.resourceId),
      expiresAt: computeExpiresAt(channel.expiration),
      id: subId,
      provider: GOOGLE_PROVIDER,
      providerAccountId: params.account.accountId,
      userId: params.userId,
      webhookToken: env.GOOGLE_WEBHOOK_TOKEN,
    });
  });

// ── Service ──────────────────────────────────────────────────────────

export class GoogleCalendarWebhookService extends Context.Service<GoogleCalendarWebhookService>()(
  "GoogleCalendarWebhookService",
  {
    make: Effect.sync(() => {
      const refreshListWatch = Effect.fn(
        "GoogleCalendarWebhookService.refreshListWatch"
      )(function* (params: {
        account: Account;
        existingSubscription?: GoogleCalendarListSubscription;
        userId: string;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        const client = yield* GoogleCalendar;

        yield* renewWatch({
          account: params.account,
          config: (resourceId) => ({
            resourceId,
            type: "google-calendar-list",
          }),
          existingSubscription: params.existingSubscription,
          stopOperation: "google-calendar-list-stop-watch",
          userId: params.userId,
          watch: (channel) =>
            client
              .watchCalendarList(channel)
              .pipe(
                Effect.mapError(toProviderError("google-calendar-list-watch"))
              ),
        });
      });

      /** Watch a calendar's events. Callers pass IDs from `listCalendarIds`, which drops calendars Google can't watch. */
      const refreshEventsWatch = Effect.fn(
        "GoogleCalendarWebhookService.refreshEventsWatch"
      )(function* (params: {
        account: Account;
        calendarId: string;
        existingSubscription?: GoogleCalendarEventsSubscription;
        userId: string;
      }) {
        yield* Effect.annotateCurrentSpan("accountId", params.account.id);
        yield* Effect.annotateCurrentSpan("calendarId", params.calendarId);
        yield* Effect.annotateCurrentSpan("userId", params.userId);
        const client = yield* GoogleCalendar;

        yield* renewWatch({
          account: params.account,
          config: (resourceId) => ({
            calendarId: params.calendarId,
            resourceId,
            type: "google-calendar-events",
          }),
          existingSubscription: params.existingSubscription,
          stopOperation: "google-calendar-events-stop-watch",
          userId: params.userId,
          watch: (channel) =>
            client.watchCalendarEvents(params.calendarId, channel).pipe(
              Effect.mapError(toProviderError("google-calendar-events-watch")),
              // Certain calendar types don't support push notifications;
              // there is then nothing to save.
              Effect.catchTag("WebhookProviderError", (error) => {
                if (!isPushNotSupportedError(error)) {
                  return Effect.fail(error);
                }
                return Effect.logWarning("GOOGLE_EVENTS_WEBHOOK_UNSUPPORTED", {
                  accountId: params.account.id,
                  calendarId: params.calendarId,
                  error,
                }).pipe(Effect.as(undefined));
              })
            ),
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
        });

        yield* deactivateSubById({
          id: params.subscription.id,
        });
      });

      /** List the IDs of the user's calendars that Google can watch (holiday calendars can't be). */
      const listCalendarIds = Effect.fn(
        "GoogleCalendarWebhookService.listCalendarIds"
      )(function* () {
        const client = yield* GoogleCalendar;

        return yield* client.listCalendarIds().pipe(
          Effect.map((calendarIds) =>
            calendarIds.filter((id) => !isGoogleHolidayCalendarId(id))
          ),
          Effect.mapError(
            toProviderError("google-calendar-events-list-calendars")
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
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DatabaseLive)
  );
}
