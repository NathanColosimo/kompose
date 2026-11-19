import { auth } from "@kompose/auth";
import { Database } from "@kompose/db";
import { connectionTable } from "@kompose/db/schema/connection";
import { implement } from "@orpc/server";
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

export const pluginsRouter = os.router({
  connections: os.connections.effect(function* ({ context }) {
    const db = yield* Database;
    const userConnections = db
      .select()
      .from(connectionTable)
      .where(eq(connectionTable.userId, context.user.id))
      .orderBy(asc(connectionTable.createdAt));

    const profiles = new Map(
      yield* Effect.forEach(
        yield* userConnections,
        ({ accountId }) =>
          Effect.tryPromise(() =>
            auth.api.accountInfo({
              query: { accountId, userId: context.user.id },
            })
          ).pipe(
            // A failed profile lookup shows the connection without a name.
            Effect.orElseSucceed(() => null),
            Effect.map((info) => [accountId, info?.user] as const)
          ),
        { concurrency: "unbounded" }
      )
    );

    // Read again: a lookup that finds the grant revoked marks its connection
    // `needs-reauth`, and Settings should offer Reconnect right away.
    return (yield* userConnections).map(
      ({ accountId, id, pluginId, status }) => {
        const profile = profiles.get(accountId);
        return {
          accountId,
          email: profile?.email ?? "",
          id,
          image: profile?.image ?? null,
          name: profile?.name ?? "",
          pluginId,
          status,
        };
      }
    );
  }),
});
