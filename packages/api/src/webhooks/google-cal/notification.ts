import { env } from "@kompose/env";
import { Effect } from "effect";
import { WebhookService } from "../webhook-service";

/**
 * Google Calendar push notifications. Google sends only `X-Goog-*` headers
 * naming the channel. The work looks up which calendar changed, clears its
 * cache, and tells the user's clients to refetch.
 */
export function handleGoogleCalendarWebhook(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");
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

  const work = Effect.gen(function* () {
    const webhooks = yield* WebhookService;
    const result = yield* webhooks.handleGoogleNotification({
      channelId,
      resourceId,
      resourceState,
    });
    // The calendar list changed: watch new calendars, drop removed ones.
    if (result.followUpRefresh) {
      yield* webhooks.refreshAll(result.followUpRefresh);
    }
  });

  return { response: new Response("OK"), work };
}
