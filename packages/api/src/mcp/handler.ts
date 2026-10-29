import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "@kompose/auth";
import { MCP_RESOURCE, MCP_SCOPE } from "@kompose/auth/mcp";
import { Database } from "@kompose/db";
import { oauthConsent, user as userTable } from "@kompose/db/schema/auth";
import {
  createMcpHandler,
  type McpRequestContext,
  McpServer,
} from "@modelcontextprotocol/server";
import { McpRegistrar } from "@orpc/mcp";
import type { User } from "better-auth";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { appRuntime } from "../runtime";
import { mcpRouter } from "./tools";

const registrar = new McpRegistrar(mcpRouter);

const mcpHandler = createMcpHandler(async (request: McpRequestContext) => {
  const server = new McpServer(
    { name: "kompose", version: "1.0.0" },
    {
      instructions:
        "Kompose is the user's calendar and task manager. Use these tools to find, create, update, and delete the user's tasks. Dates are YYYY-MM-DD and times are the user's local time.",
    }
  );
  const user = request.authInfo?.extra?.user as User | undefined;
  await registrar.register(server, {
    context: async () => ({
      "effect/context": await appRuntime.context(),
      user,
    }),
  });
  return server;
});

/**
 * The user behind a token, if they still allow its client. Revoking an agent
 * deletes the consent row, so this cuts it off on its next request instead of
 * when its JWT expires.
 */
function findConsentingUser({
  clientId,
  userId,
}: {
  clientId: string;
  userId: string;
}) {
  return Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ user: userTable })
      .from(oauthConsent)
      .innerJoin(userTable, eq(userTable.id, oauthConsent.userId))
      .where(
        and(
          eq(oauthConsent.userId, userId),
          eq(oauthConsent.clientId, clientId)
        )
      )
      .limit(1);
    return row?.user ?? null;
  });
}

const unauthorized = () =>
  Response.json(
    {
      error: { code: -32_001, message: "Access to Kompose was revoked" },
      id: null,
      jsonrpc: "2.0",
    },
    { status: 401 }
  );

/** POST /api/mcp: stateless MCP over HTTP, authorized by Better Auth OAuth. */
export const handleMcpRequest = requireMcpAuth(
  auth,
  async (request, claims) => {
    const userId = typeof claims.sub === "string" ? claims.sub : null;
    const clientId = typeof claims.azp === "string" ? claims.azp : null;
    if (!(userId && clientId)) {
      return unauthorized();
    }
    const user = await appRuntime.runPromise(
      findConsentingUser({ clientId, userId })
    );
    if (!user) {
      return unauthorized();
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        clientId,
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        extra: { user },
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        token: request.headers.get("authorization")?.slice(7) ?? "",
      },
    });
  },
  { requiredScopes: [MCP_SCOPE], resource: MCP_RESOURCE }
);
