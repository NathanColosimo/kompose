/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import * as activitySchema from "./schema/activity";
import * as authSchema from "./schema/auth";
import * as connectionSchema from "./schema/connection";
import * as dayMetricSchema from "./schema/day-metric";
import * as tagSchema from "./schema/tag";
import * as taskSchema from "./schema/task";
import * as webhookSubscriptionSchema from "./schema/webhook-subscription";

export const schema = {
  ...activitySchema,
  ...authSchema,
  ...connectionSchema,
  ...dayMetricSchema,
  ...taskSchema,
  ...tagSchema,
  ...webhookSubscriptionSchema,
};
