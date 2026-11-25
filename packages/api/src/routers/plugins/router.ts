import { auth } from "@kompose/auth";
import { Database } from "@kompose/db";
import { connectionTable } from "@kompose/db/schema/connection";
import { implement } from "@orpc/server";
import { waitUntil } from "@vercel/functions";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { pluginsContract } from "./contract";

const os = implement(pluginsContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

/** A stored profile older than this is fetched again, after the reply. */
const PROFILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Asks the provider for the account's profile and stores it on the
 * connection. Returns the row as it is afterwards. A failed lookup keeps
 * what is stored.
 */
const refreshProfile = Effect.fn("Plugins.refreshProfile")(function* (
  connection: typeof connectionTable.$inferSelect
) {
  yield* Effect.annotateCurrentSpan("connectionId", connection.id);
  const db = yield* Database;
  const thisConnection = eq(connectionTable.id, connection.id);

  const info = yield* Effect.tryPromise(() =>
    auth.api.accountInfo({
      query: { accountId: connection.accountId, userId: connection.userId },
    })
  ).pipe(Effect.orElseSucceed(() => null));

  const profile = info?.user;
  const [row] = profile
    ? yield* db
        .update(connectionTable)
        .set({
          email: profile.email ?? null,
          image: profile.image ?? null,
          name: profile.name ?? null,
          profileUpdatedAt: new Date().toISOString(),
        })
        .where(thisConnection)
        .returning()
    : // A lookup that finds the grant revoked marks the connection
      // `needs-reauth`; read it so Settings offers Reconnect right away.
      yield* db.select().from(connectionTable).where(thisConnection);
  return row ?? connection;
});

export const pluginsRouter = os.router({
  connections: os.connections.effect(function* ({ context }) {
    const db = yield* Database;
    const stored = yield* db
      .select()
      .from(connectionTable)
      .where(eq(connectionTable.userId, context.user.id))
      .orderBy(asc(connectionTable.createdAt));

    // A connection listed for the first time has no profile yet. Fetch it
    // now, once; every later read answers from the row. Only an `active`
    // connection is asked: a `needs-reauth` one has no usable token until
    // the user reconnects it.
    const connections = yield* Effect.forEach(
      stored,
      (connection) =>
        connection.status === "active" && connection.profileUpdatedAt === null
          ? refreshProfile(connection)
          : Effect.succeed(connection),
      { concurrency: "unbounded" }
    );

    const staleBefore = Date.now() - PROFILE_MAX_AGE_MS;
    const stale = connections.filter(
      ({ profileUpdatedAt, status }) =>
        status === "active" &&
        profileUpdatedAt !== null &&
        Date.parse(profileUpdatedAt) < staleBefore
    );
    if (stale.length > 0) {
      // Answer with the stored profiles and refresh after the reply. Two
      // requests may refresh the same profile; both write the same values.
      waitUntil(
        Effect.runPromiseWith(context["effect/context"])(
          Effect.forEach(stale, refreshProfile, {
            concurrency: "unbounded",
            discard: true,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("PLUGIN_PROFILE_REFRESH_FAILED", { cause })
            ),
            // Its own trace, flushed like a webhook's work (telemetry.ts).
            Effect.withSpan("Plugins.refreshProfiles", {
              kind: "consumer",
              root: true,
            })
          )
        )
      );
    }

    return connections.map(
      ({ accountId, email, id, image, name, pluginId, status }) => ({
        accountId,
        email: email ?? "",
        id,
        image,
        name: name ?? "",
        pluginId,
        status,
      })
    );
  }),
});
