import type { PluginId } from "@kompose/plugins";
import { implement } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { createUserSyncEventIterator } from "../../realtime/sync";
import type { AppServices } from "../../runtime";
import { WebhookService } from "../../webhooks/webhook-service";
import { WhoopService } from "../whoop/service";
import { syncContract } from "./contract";

const os = implement(syncContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

/**
 * What a plugin does for a user when one of their clients connects. A new
 * plugin's goes here. See documents/plugins.md.
 */
const connectWork = new Map<
  PluginId,
  (userId: string) => Effect.Effect<void, unknown, AppServices>
>([
  [
    "google-calendar",
    (userId) => WebhookService.use((service) => service.refreshAll({ userId })),
  ],
  ["whoop", (userId) => WhoopService.use((whoop) => whoop.syncRecent(userId))],
]);

export const syncRouter = os.router({
  events: os.events.handler(({ context, signal }) => {
    const userId = context.user.id;
    // Fire-and-forget: the stream shouldn't wait on any plugin.
    for (const [pluginId, work] of connectWork) {
      Effect.runForkWith(context["effect/context"])(
        work(userId).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("PLUGIN_CONNECT_WORK_FAILED", {
              cause,
              pluginId,
              userId,
            })
          )
        )
      );
    }

    return createUserSyncEventIterator(userId, signal);
  }),
});
