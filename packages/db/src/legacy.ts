import { env } from "@kompose/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { relations as dbRelations } from "./schema/relations";

const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle({
  client,
  relations: dbRelations,
});
