import { env } from "@kompose/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema as dbSchema } from "./schema";

const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle({
  client,
  schema: dbSchema,
});
