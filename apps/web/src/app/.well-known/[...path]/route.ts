import { auth } from "@kompose/auth";

/**
 * OAuth discovery for MCP clients. RFC 8414 and RFC 9728 put metadata at the
 * site root (e.g. /.well-known/oauth-protected-resource/api/mcp), outside the
 * /api/auth catch-all, so forward it to Better Auth, which serves it.
 */
export const GET = auth.handler;
