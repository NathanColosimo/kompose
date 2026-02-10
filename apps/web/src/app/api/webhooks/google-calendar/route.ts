/** biome-ignore-all lint/correctness/noNestedComponentDefinitions: route handler */
import { TelemetryLive } from "@kompose/api/telemetry";
import { WebhookService } from "@kompose/api/webhooks/webhook-service";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Effect, Layer } from "effect";

const tracer = trace.getTracer("kompose-api");
const WebhookLive = Layer.merge(WebhookService.Default, TelemetryLive);

export async function POST(request: Request): Promise<Response> {
  return await tracer.startActiveSpan(
    "webhook.google-calendar",
    async (span) => {
      // Annotate the root span with Google webhook headers for searchability
      const channelId = request.headers.get("x-goog-channel-id");
      const resourceId = request.headers.get("x-goog-resource-id");
      const resourceState = request.headers.get("x-goog-resource-state");
      if (channelId) {
        span.setAttribute("webhook.channelId", channelId);
      }
      if (resourceId) {
        span.setAttribute("webhook.resourceId", resourceId);
      }
      if (resourceState) {
        span.setAttribute("webhook.resourceState", resourceState);
      }

      try {
        const result = await Effect.runPromise(
          WebhookService.handleGoogleNotification({
            headers: request.headers,
          }).pipe(
            Effect.catchTags({
              WebhookValidationError: (error) =>
                Effect.succeed(new Response(error.message, { status: 400 })),
              WebhookRepositoryError: (error) =>
                Effect.succeed(new Response(error.message, { status: 202 })),
            }),
            Effect.provide(WebhookLive)
          )
        );

        // Error cases are caught above and returned as Response
        if (result instanceof Response) {
          span.setAttribute("http.status_code", result.status);
          return result;
        }

        // Fire-and-forget webhook refresh when calendar list changes
        if (result.followUpRefresh) {
          Effect.runPromise(
            WebhookService.refreshAll({
              accountId: result.followUpRefresh.accountId,
              userId: result.followUpRefresh.userId,
            }).pipe(
              Effect.tapError((error) =>
                Effect.logError(
                  "GOOGLE_WEBHOOK_SETUP_FAILED_ON_CALENDAR_LIST_CHANGE",
                  { error }
                )
              ),
              Effect.catchTags({
                WebhookRepositoryError: () => Effect.void,
              }),
              Effect.provide(WebhookLive)
            )
          ).catch(() => undefined);
        }

        span.setAttribute("http.status_code", 200);
        return new Response("OK", { status: 200 });
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute("http.status_code", 500);
        return new Response("Internal Server Error", { status: 500 });
      } finally {
        span.end();
      }
    }
  );
}
