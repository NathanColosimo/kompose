import { activityDetailsSchemas } from "@kompose/db/schema/activity";
import { dayMetrics } from "@kompose/db/schema/day-metric";
import { pluginIdSchema } from "@kompose/plugins";
import { oc } from "@orpc/contract";
import z from "zod";

const MAX_RANGE_DAYS = 62;
const MS_PER_DAY = 86_400_000;

const plainDateSchema = z.iso.date();

const activityShape = {
  /** The day it counts toward: a sleep's is the day the user woke up. */
  date: plainDateSchema,
  endAt: z.iso.datetime(),
  id: z.uuid(),
  /** The plugin that recorded it. */
  pluginId: pluginIdSchema,
  startAt: z.iso.datetime(),
  /** The provider's name for it, such as a workout's sport. */
  title: z.string().nullable(),
};

const activitySchema = z.discriminatedUnion("kind", [
  z.object({
    ...activityShape,
    details: activityDetailsSchemas.sleep,
    kind: z.literal("sleep"),
  }),
  z.object({
    ...activityShape,
    details: activityDetailsSchemas.workout,
    kind: z.literal("workout"),
  }),
]);

const dayMetricSchema = z.object({
  date: plainDateSchema,
  metric: z.enum(dayMetrics),
  pluginId: pluginIdSchema,
  value: z.number(),
});

const dayDataSchema = z.object({
  activities: z.array(activitySchema),
  metrics: z.array(dayMetricSchema),
});

export const daysContract = {
  /**
   * What the user's plugins recorded about a range of days: the numbers of
   * each day, and the activities that count toward those days.
   */
  list: oc
    .input(
      z.object({ endDate: plainDateSchema, startDate: plainDateSchema }).refine(
        ({ endDate, startDate }) => {
          const days =
            (Date.parse(endDate) - Date.parse(startDate)) / MS_PER_DAY;
          return days >= 0 && days < MAX_RANGE_DAYS;
        },
        { error: `The range must be 1 to ${MAX_RANGE_DAYS} days` }
      )
    )
    .output(dayDataSchema),
};

export type Activity = z.infer<typeof activitySchema>;
export type DayData = z.infer<typeof dayDataSchema>;
