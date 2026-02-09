import { implement } from "@orpc/server";
import { Effect, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { createUserSyncEventIterator } from "../../realtime/sync";
import { TelemetryLive } from "../../telemetry";
import { WebhookService } from "../../webhooks/webhook-service";
import { syncContract } from "./contract";

const SyncLive = Layer.merge(WebhookService.Default, TelemetryLive);

const os = implement(syncContract).use(requireAuth).use(globalRateLimit);

export const syncRouter = os.router({
  events: os.events.handler(({ context }) => {
    Effect.runPromise(
      WebhookService.refreshAll({
        userId: context.user.id,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("GOOGLE_WEBHOOK_SETUP_FAILED_ON_REALTIME_CONNECT", {
            error,
            userId: context.user.id,
          })
        ),
        Effect.catchTags({
          WebhookRepositoryError: () => Effect.void,
        }),
        Effect.provide(SyncLive)
      )
    ).catch(() => undefined);

    return createUserSyncEventIterator(context.user.id);
  }),
});
