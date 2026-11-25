import { Database } from "@kompose/db";
import {
  activitySelectSchema,
  activityTable,
} from "@kompose/db/schema/activity";
import { connectionTable } from "@kompose/db/schema/connection";
import { dayMetricTable } from "@kompose/db/schema/day-metric";
import type { PluginId } from "@kompose/plugins";
import { implement } from "@orpc/server";
import { and, between, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import type { AppServices } from "../../runtime";
import { WhoopService } from "../whoop/service";
import { daysContract } from "./contract";

const os = implement(daysContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

/**
 * A plugin that fetches its data stores the days of a read that it never
 * stored, before the read answers. A new plugin's goes here. See "Keeping the
 * rows current" in documents/plugins.md.
 */
const readSyncs = new Map<
  PluginId,
  (
    userId: string,
    startDate: string,
    endDate: string
  ) => Effect.Effect<void, unknown, AppServices>
>([
  [
    "whoop",
    (userId, startDate, endDate) =>
      WhoopService.use((whoop) =>
        whoop.syncMissing(userId, startDate, endDate)
      ),
  ],
]);

export const daysRouter = os.router({
  list: os.list.effect(function* ({ context, input }) {
    const db = yield* Database;
    const userId = context.user.id;
    const { endDate, startDate } = input;

    const linked = yield* db
      .selectDistinct({ pluginId: connectionTable.pluginId })
      .from(connectionTable)
      .where(eq(connectionTable.userId, userId));
    // A plugin whose provider can't be reached still has its stored days.
    yield* Effect.forEach(
      linked,
      ({ pluginId }) =>
        (
          readSyncs.get(pluginId)?.(userId, startDate, endDate) ?? Effect.void
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("PLUGIN_READ_SYNC_FAILED", { cause, pluginId })
          )
        ),
      { concurrency: "unbounded", discard: true }
    );

    // Only WHOOP writes these tables today. When a second plugin does, this
    // is where the server picks one of two rows for the same thing; see "Two
    // plugins that report the same thing" in documents/plugins.md.
    const [metrics, activities] = yield* Effect.all(
      [
        db
          .select({
            date: dayMetricTable.date,
            metric: dayMetricTable.metric,
            pluginId: connectionTable.pluginId,
            value: dayMetricTable.value,
          })
          .from(dayMetricTable)
          .innerJoin(
            connectionTable,
            eq(dayMetricTable.connectionId, connectionTable.id)
          )
          .where(
            and(
              eq(connectionTable.userId, userId),
              between(dayMetricTable.date, startDate, endDate)
            )
          )
          .orderBy(dayMetricTable.date),
        db
          .select({
            activity: activityTable,
            pluginId: connectionTable.pluginId,
          })
          .from(activityTable)
          .innerJoin(
            connectionTable,
            eq(activityTable.connectionId, connectionTable.id)
          )
          .where(
            and(
              eq(connectionTable.userId, userId),
              between(activityTable.date, startDate, endDate)
            )
          )
          .orderBy(activityTable.startAt),
      ],
      { concurrency: "unbounded" }
    );

    return {
      activities: activities.map(({ activity, pluginId }) => {
        const { connectionId, externalId, endAt, startAt, ...rest } =
          activitySelectSchema.parse(activity);
        return {
          ...rest,
          endAt: endAt.toISOString(),
          pluginId,
          startAt: startAt.toISOString(),
        };
      }),
      metrics,
    };
  }),
});
