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
    const connections = yield* db
      .select()
      .from(connectionTable)
      .where(eq(connectionTable.userId, context.user.id))
      .orderBy(asc(connectionTable.createdAt));
    return yield* Effect.forEach(
      connections,
      ({ accountId, id, pluginId, status }) =>
        Effect.tryPromise(() =>
          auth.api.accountInfo({
            query: { accountId, userId: context.user.id },
          })
        ).pipe(
          // A failed profile lookup shows the connection without a name.
          Effect.orElseSucceed(() => null),
          Effect.map((info) => ({
            accountId,
            email: info?.user?.email ?? "",
            id,
            image: info?.user?.image ?? null,
            name: info?.user?.name ?? "",
            pluginId,
            status,
          }))
        ),
      { concurrency: "unbounded" }
    );
  }),
});
