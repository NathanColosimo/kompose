import { env } from "@kompose/env";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/** Protected resource identifier MCP access tokens are bound to (`aud`). */
export const MCP_RESOURCE = `${env.NEXT_PUBLIC_WEB_URL}/api/mcp`;

/** The one scope agents request: read and write the user's tasks and tags. */
export const MCP_SCOPE = "tasks";

/**
 * Better Auth only issues refresh tokens for `offline_access`, which the MCP
 * plugin leaves out of the scopes it advertises, so agents that request just
 * `tasks` would have to reconnect every 15 minutes. Add it to every MCP
 * authorization; removing an agent in Settings still cuts it off at once.
 */
export function mcpOfflineAccess(): BetterAuthPlugin {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const isPost = ctx.method === "POST";
            const params: Record<string, unknown> =
              (isPost ? ctx.body : ctx.query) ?? {};
            const scopes =
              typeof params.scope === "string" ? params.scope.split(" ") : [];
            if (
              !scopes.includes(MCP_SCOPE) ||
              scopes.includes("offline_access")
            ) {
              return;
            }
            const updated = {
              ...params,
              scope: [...scopes, "offline_access"].join(" "),
            };
            return { context: isPost ? { body: updated } : { query: updated } };
          }),
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
        },
      ],
    },
    id: "mcp-offline-access",
  };
}
