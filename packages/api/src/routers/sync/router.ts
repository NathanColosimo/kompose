import { implement } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { createUserSyncEventIterator } from "../../realtime/sync";
import { WebhookService } from "../../webhooks/webhook-service";
import { syncContract } from "./contract";

const os = implement(syncContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

export const syncRouter = os.router({
  events: os.events.handler(({ context }) => {
    // Fire-and-forget: the stream shouldn't wait on Google watch renewal.
    Effect.runForkWith(context["effect/context"])(
      WebhookService.use((service) =>
        service.refreshAll({
          userId: context.user.id,
        })
      ).pipe(
        Effect.tapError((error) =>
          Effect.logError("GOOGLE_WEBHOOK_SETUP_FAILED_ON_REALTIME_CONNECT", {
            error,
            userId: context.user.id,
          })
        ),
        Effect.ignore
      )
    );

    return createUserSyncEventIterator(context.user.id);
  }),
});
