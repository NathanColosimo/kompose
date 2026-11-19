import { Effect } from "effect";
import type { AppServices } from "../runtime";
import { handleGoogleCalendarWebhook } from "./google-cal/notification";

/** What a handler decides about one call from an outside service. */
interface WebhookResult {
  /** Sent to the service right away. */
  response: Response;
  /** Runs after the response is sent. */
  work?: Effect.Effect<void, unknown, AppServices>;
}

/**
 * Checks one call and says how to answer it. It gets the raw request because
 * services sign the exact bytes of the body. Anything slow goes in `work`:
 * services stop waiting after a few seconds and send the call again.
 */
type WebhookHandler = (
  request: Request
) => WebhookResult | Promise<WebhookResult>;

/** The handler behind each `/api/webhooks/<source>`. A plugin's source is its ID. */
const webhookHandlers = new Map<string, WebhookHandler>([
  ["google-calendar", handleGoogleCalendarWebhook],
]);

/**
 * Answers a call to `/api/webhooks/<source>`. The caller sends `response`,
 * then runs `work`, which never fails: a failure is logged instead.
 * See documents/plugins.md.
 */
export async function receiveWebhook(source: string, request: Request) {
  const handler = webhookHandlers.get(source);
  if (!handler) {
    return { response: new Response("Unknown webhook", { status: 404 }) };
  }

  const { response, work } = await handler(request);
  return {
    response,
    work: work?.pipe(
      Effect.catch((error) =>
        Effect.logWarning("WEBHOOK_WORK_FAILED", { error, source })
      ),
      // The request's spans were flushed when it replied. A root consumer span
      // gets its own flush before Vercel freezes the function (telemetry.ts),
      // and stays out of the dashboards' one-row-per-request `server` spans.
      Effect.withSpan("Webhook.work", {
        attributes: { source },
        kind: "consumer",
        root: true,
      })
    ),
  };
}
