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
import { and, eq } from "drizzle-orm";
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

/** Require HTTPS and reject localhost/127.0.0.1; this isn't a public-address check. */
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

/** Fall back to our requested TTL if Google omits a usable expiration. */
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

function isPushNotSupportedError(error: WebhookProviderError): boolean {
  return (
    error.operation === "google-calendar-events-watch" &&
    (error.message.includes("pushNotSupportedForRequestedResource") ||
      error.message.includes(
        "Push notifications are not supported by this resource."
      ))
  );
}

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

/** Save a replacement channel before retiring the old one. */
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

    yield* validateCallbackUrl();

    const subId = uuidv7();
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

    const db = yield* Database;
    const values: WebhookSubscriptionInsert = {
      accountId: params.account.id,
      active: true,
      config: params.config(channel.resourceId),
      expiresAt: computeExpiresAt(channel.expiration),
      id: subId,
      provider: GOOGLE_PROVIDER,
      providerAccountId: params.account.accountId,
      userId: params.userId,
      webhookToken: env.GOOGLE_WEBHOOK_TOKEN,
    };
    const save = existing
      ? db
          .update(webhookSubscriptionTable)
          .set(values)
          .where(
            and(
              eq(webhookSubscriptionTable.id, existing.id),
              eq(webhookSubscriptionTable.active, existing.active)
            )
          )
          .returning({ id: webhookSubscriptionTable.id })
      : db
          .insert(webhookSubscriptionTable)
          .values(values)
          .returning({ id: webhookSubscriptionTable.id });
    const stopNew = stopWatch({
      id: subId,
      operation: params.stopOperation,
      resourceId: channel.resourceId,
    });
    const saved = yield* save.pipe(Effect.onError(() => stopNew));
    // Another renewal or unlink may already have replaced/deleted this row.
    if (saved.length === 0) {
      yield* stopNew;
      return;
    }
    if (existing?.active) {
      yield* stopWatch({
        id: existing.id,
        operation: params.stopOperation,
        resourceId: existing.config.resourceId,
      });
    }
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
              // Other non-holiday calendars can also reject push notifications.
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

      /** Exclude known holiday calendars; other unsupported watches are handled at renewal. */
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
