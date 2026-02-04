/** biome-ignore-all lint/performance/noNamespaceImport: Drizzle schema */
import { env } from "@kompose/env";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as authSchema from "./schema/auth";
import * as relationsSchema from "./schema/relations";
import * as tagSchema from "./schema/tag";
import * as taskSchema from "./schema/task";

const client = new SQL(env.DATABASE_URL);

export const db = drizzle(client, {
  schema: { ...authSchema, ...taskSchema, ...tagSchema, ...relationsSchema },
});
