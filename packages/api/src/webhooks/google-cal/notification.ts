import { env } from "@kompose/env";
import { Effect } from "effect";
import { WebhookService } from "../webhook-service";

/**
 * Google Calendar push notifications. Google sends only `X-Goog-*` headers
 * naming the channel. `response` goes back to Google at once; `sync`, if any,
 * runs after it's sent: it looks up which calendar changed, clears its cache,
 * and tells the user's clients to refetch.
 */
export function handleGoogleCalendarWebhook(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  if (!(channelId && resourceId)) {
    return {
      response: new Response("Missing Google channel headers", { status: 400 }),
    };
  }
  if (
    request.headers.get("x-goog-channel-token") !== env.GOOGLE_WEBHOOK_TOKEN
  ) {
    return {
      response: new Response("Invalid Google channel token", { status: 400 }),
    };
  }

  const sync = Effect.gen(function* () {
    const webhooks = yield* WebhookService;
    const result = yield* webhooks.handleGoogleNotification({
      channelId,
      resourceId,
      resourceState: request.headers.get("x-goog-resource-state"),
    });
    // The calendar list changed: watch new calendars, drop removed ones.
    if (result.followUpRefresh) {
      yield* webhooks.refreshAll(result.followUpRefresh);
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("GOOGLE_WEBHOOK_SYNC_FAILED", { channelId, error })
    ),
    // The request's spans were flushed when it replied. A root consumer span
    // gets its own flush before Vercel freezes the function (telemetry.ts),
    // and stays out of the dashboards' one-row-per-request `server` spans.
    Effect.withSpan("GoogleCalendarWebhook.sync", {
      attributes: { channelId, resourceId },
      kind: "consumer",
      root: true,
    })
  );

  return { response: new Response("OK"), sync };
}
