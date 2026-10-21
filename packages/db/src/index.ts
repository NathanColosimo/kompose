import { layer as pgClientLayer } from "@effect/sql-pg/PgClient";
import { env } from "@kompose/env";
import {
  DefaultServices,
  make as makePgDrizzle,
} from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted } from "effect";
import { relations as dbRelations } from "./schema/relations";

export const PgClientLive = pgClientLayer({
  // Production connects through Supabase's transaction-mode pooler, which
  // can't keep named prepared statements across transactions. The previous
  // pg-based client never named its statements either.
  prepare: false,
  url: Redacted.make(env.DATABASE_URL),
});

const databaseEffect = makePgDrizzle({ relations: dbRelations }).pipe(
  Effect.provide(DefaultServices)
);

export class Database extends Context.Service<
  Database,
  Effect.Success<typeof databaseEffect>
>()("Database") {}

export const DatabaseLive = Layer.effect(Database, databaseEffect).pipe(
  Layer.provide(PgClientLive),
  Layer.orDie
);
