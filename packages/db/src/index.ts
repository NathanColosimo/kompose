/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import { env } from "@kompose/env";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./schema/auth";
import * as taskSchema from "./schema/task";

export const db = drizzle(env.DATABASE_URL, {
  schema: { ...authSchema, ...taskSchema },
});
