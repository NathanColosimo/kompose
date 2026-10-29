import { Database } from "@kompose/db";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@kompose/db/schema/auth";
import { implement } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { agentsContract } from "./contract";

const os = implement(agentsContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

export const agentsRouter = os.router({
  list: os.list.effect(function* ({ context }) {
    const db = yield* Database;
    const rows = yield* db
      .select({ client: oauthClient, consent: oauthConsent })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(eq(oauthConsent.userId, context.user.id))
      .orderBy(desc(oauthConsent.createdAt));
    return rows.map(({ client, consent }) => ({
      clientId: client.clientId,
      connectedAt: consent.createdAt.toISOString(),
      icon: client.icon,
      name: client.name ?? client.uri ?? client.clientId,
    }));
  }),

  /**
   * Cuts an agent off now: /api/mcp checks the consent on every request, and
   * without a refresh token the agent can't get a new access token.
   */
  revoke: os.revoke.effect(function* ({ input, context }) {
    const db = yield* Database;
    const userId = context.user.id;
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .delete(oauthConsent)
          .where(
            and(
              eq(oauthConsent.userId, userId),
              eq(oauthConsent.clientId, input.clientId)
            )
          );
        yield* tx
          .delete(oauthRefreshToken)
          .where(
            and(
              eq(oauthRefreshToken.userId, userId),
              eq(oauthRefreshToken.clientId, input.clientId)
            )
          );
        yield* tx
          .delete(oauthAccessToken)
          .where(
            and(
              eq(oauthAccessToken.userId, userId),
              eq(oauthAccessToken.clientId, input.clientId)
            )
          );
      })
    );
    return null;
  }),
});
