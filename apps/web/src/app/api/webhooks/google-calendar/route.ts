/** biome-ignore-all lint/correctness/noNestedComponentDefinitions: route handler */
import { WebhookService } from "@kompose/api/webhooks/webhook-service";
import { Effect } from "effect";

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
      Effect.provide(WebhookService.Default)
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
        Effect.provide(WebhookService.Default)
      )
    ).catch(() => undefined);
  }

  return new Response("OK", { status: 200 });
}
