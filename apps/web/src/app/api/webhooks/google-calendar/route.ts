/** biome-ignore-all lint/correctness/noNestedComponentDefinitions: route handler */
import { TelemetryLive } from "@kompose/api/telemetry";
import { WebhookService } from "@kompose/api/webhooks/webhook-service";
import { Effect, Layer } from "effect";

const WebhookLive = Layer.merge(WebhookService.Default, TelemetryLive);

export async function POST(request: Request): Promise<Response> {
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

  return new Response("OK", { status: 200 });
}
