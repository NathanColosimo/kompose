/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import * as authSchema from "./schema/auth";
import * as tagSchema from "./schema/tag";
import * as taskSchema from "./schema/task";
import * as webhookSubscriptionSchema from "./schema/webhook-subscription";

export const schema = {
  ...authSchema,
  ...taskSchema,
  ...tagSchema,
  ...webhookSubscriptionSchema,
};
