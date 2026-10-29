import { env } from "@kompose/env";

/** Protected resource identifier MCP access tokens are bound to (`aud`). */
export const MCP_RESOURCE = `${env.NEXT_PUBLIC_WEB_URL}/api/mcp`;

/** The one scope agents request: read and write the user's tasks and tags. */
export const MCP_SCOPE = "tasks";
