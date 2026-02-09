import { implement } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import { createUserSyncEventIterator } from "../../realtime/sync";
import { WebhookService } from "../../webhooks/webhook-service";
import { syncContract } from "./contract";

const os = implement(syncContract).use(requireAuth);

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
        Effect.provide(WebhookService.Default)
      )
    ).catch(() => undefined);

    return createUserSyncEventIterator(context.user.id);
  }),
});
