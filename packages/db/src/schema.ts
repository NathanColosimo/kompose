/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import * as aiSchema from "./schema/ai";
import * as authSchema from "./schema/auth";
import * as relationsSchema from "./schema/relations";
import * as tagSchema from "./schema/tag";
import * as taskSchema from "./schema/task";
import * as webhookSubscriptionSchema from "./schema/webhook-subscription";

export const schema = {
  ...aiSchema,
  ...authSchema,
  ...taskSchema,
  ...tagSchema,
  ...relationsSchema,
  ...webhookSubscriptionSchema,
};
