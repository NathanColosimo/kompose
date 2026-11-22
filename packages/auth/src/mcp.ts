import { env } from "@kompose/env";

/** Protected resource identifier MCP access tokens are bound to (`aud`). */
export const MCP_RESOURCE = `${env.NEXT_PUBLIC_WEB_URL}/api/mcp`;

/** The one scope agents request: read and write the user's tasks and tags. */
export const MCP_SCOPE = "tasks";

/**
 * The domain to show for an MCP client. A CIMD client_id is the URL of the
 * app's own metadata, so its host is one the app has proven it controls.
 * client_uri is self-declared and, under CIMD draft-03, may name any domain.
 */
export function clientHost(clientId: string): string | null {
  return URL.canParse(clientId) ? new URL(clientId).host : null;
}
