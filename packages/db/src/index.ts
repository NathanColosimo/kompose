import { layer as pgClientLayer } from "@effect/sql-pg/PgClient";
import { CodecError, makeRegistry, OID } from "@effect/sql-pg/PgTypes";
import { env } from "@kompose/env";
import {
  DefaultServices,
  make as makePgDrizzle,
} from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted, Result } from "effect";
import { relations as dbRelations } from "./schema/relations";

const MICROS_PER_SECOND = 1_000_000n;
const TRAILING_ZEROS = /0+$/;
const pad2 = (value: bigint) => value.toString().padStart(2, "0");

/**
 * Formats a binary `time` value (microseconds since midnight) the way
 * Postgres prints it as text, e.g. "09:30:00" or "23:59:59.5".
 */
function formatPgTime(micros: bigint): string {
  const totalSeconds = micros / MICROS_PER_SECOND;
  const fraction = micros % MICROS_PER_SECOND;
  const hms = `${pad2(totalSeconds / 3600n)}:${pad2((totalSeconds / 60n) % 60n)}:${pad2(totalSeconds % 60n)}`;
  if (fraction === 0n) {
    return hms;
  }
  return `${hms}.${fraction.toString().padStart(6, "0").replace(TRAILING_ZEROS, "")}`;
}

// The native driver decodes `time` to bigint microseconds by default; the
// schema and clients expect Postgres' "HH:MM:SS" strings. Drizzle already
// casts date/timestamp columns to text, so only `time` needs a codec.
const pgTypes = makeRegistry();
pgTypes.register<string>(OID.time, {
  decode: (bytes) =>
    Result.succeed(
      formatPgTime(
        new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0)
      )
    ),
  // Drizzle sends time params as untyped text, so this codec never encodes.
  encode: () =>
    Result.fail(new CodecError({ message: "time params are sent as text" })),
});

export const PgClientLive = pgClientLayer({
  // DATABASE_URL may go through a transaction pooler, which can't keep
  // named prepared statements across transactions.
  prepare: false,
  types: pgTypes,
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
