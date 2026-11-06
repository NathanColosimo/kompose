import { layer as pgClientLayer } from "@effect/sql-pg/PgClient";
import { env } from "@kompose/env";
import {
  DefaultServices,
  make as makePgDrizzle,
} from "drizzle-orm/effect-postgres";
import { Context, Duration, Effect, Layer, Redacted } from "effect";
import { relations as dbRelations } from "./schema/relations";

export const PgClientLive = pgClientLayer({
  // The default is 60 s. An instance that wakes from a longer idle gap closes
  // the pooled connection before the waking request runs, so that request
  // opens a new one. See "Postgres connections" in documents/services.md.
  idleTimeout: Duration.minutes(4),
  // Matches postgres.js (legacy.ts). Probes keep a NAT mapping alive and
  // detect a dead peer while the connection sits idle.
  keepAlive: Duration.seconds(60),
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

/**
 * Pass to every `ManagedRuntime` in the process (`appRuntime` in
 * `@kompose/api`, the OAuth token hook in `@kompose/auth`). Runtimes that
 * share it build a shared layer such as `DatabaseLive` once, so they share one
 * Postgres pool.
 */
export const runtimeMemoMap = Layer.makeMemoMapUnsafe();
