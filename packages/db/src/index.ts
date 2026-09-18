import { layer as pgClientLayer } from "@effect/sql-pg/PgClient";
import { env } from "@kompose/env";
import {
  DefaultServices,
  make as makePgDrizzle,
} from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted } from "effect";
import { types } from "pg";
import { relations as dbRelations } from "./schema/relations";

const rawDateTimeTypeIds = new Set([
  1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182,
]);

export const PgClientLive = pgClientLayer({
  types: {
    getTypeParser: (typeId: number, format: "text" | "binary" | undefined) => {
      if (rawDateTimeTypeIds.has(typeId)) {
        return (value: string) => value;
      }
      return types.getTypeParser(typeId, format);
    },
  },
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
