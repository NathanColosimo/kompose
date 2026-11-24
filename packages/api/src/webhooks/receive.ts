import { type PluginId, pluginIdSchema } from "@kompose/plugins";
import { Effect } from "effect";
import type { AppServices } from "../runtime";
import { handleGoogleCalendarWebhook } from "./google-cal/notification";
import { handleWhoopWebhook } from "./whoop";

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

/** The handler behind `/api/webhooks/<plugin ID>`, for each plugin that sends webhooks. */
const webhookHandlers = new Map<PluginId, WebhookHandler>([
  ["google-calendar", handleGoogleCalendarWebhook],
  ["whoop", handleWhoopWebhook],
]);

/**
 * Answers a call to `/api/webhooks/<source>`. The caller sends `response`,
 * then runs `work`, which never fails: a failure is logged instead.
 * See documents/plugins.md.
 */
export async function receiveWebhook(source: string, request: Request) {
  const pluginId = pluginIdSchema.safeParse(source);
  const handler = pluginId.success
    ? webhookHandlers.get(pluginId.data)
    : undefined;
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
