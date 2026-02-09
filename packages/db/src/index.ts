/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import { env } from "@kompose/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema/auth";
import * as relationsSchema from "./schema/relations";
import * as tagSchema from "./schema/tag";
import * as taskSchema from "./schema/task";
import * as webhookSubscriptionSchema from "./schema/webhook-subscription";

const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, {
  schema: {
    ...authSchema,
    ...taskSchema,
    ...tagSchema,
    ...relationsSchema,
    ...webhookSubscriptionSchema,
  },
});
