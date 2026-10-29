# MCP Server

Lets the user's own AI agents (ChatGPT, Claude, any MCP client) search and manage their Kompose tasks. The agent connects to `https://kompose.dev/api/mcp`, signs the user in with OAuth, and gets six tools.

## How it works

1. The user adds `https://kompose.dev/api/mcp` as a custom connector in their AI app. Settings shows the URL under **AI Agents** on web and native.
2. The agent calls `/api/mcp`, gets a `401` whose `WWW-Authenticate` header points at `/.well-known/oauth-protected-resource/api/mcp`, and discovers Better Auth as the authorization server.
3. The agent identifies itself with a Client ID Metadata Document (CIMD): its `client_id` is an HTTPS URL to its own metadata, so no registration step is needed.
4. The user signs in at `/login` if needed, then approves the agent at `/oauth/consent`.
5. The agent exchanges the code for a 15-minute JWT access token and a refresh token, both bound to the `/api/mcp` resource with the `tasks` scope.
6. Each MCP request is a stateless `POST`. The route verifies the JWT, checks the user's consent for that agent still exists, and runs the tool.

## Auth

Configured in `packages/auth/src/index.ts`; constants in `packages/auth/src/mcp.ts`.

- `jwt()` signs access tokens and serves `/api/auth/jwks`.
- `mcp()` from `@better-auth/mcp` is the OAuth 2.1 provider (built on `@better-auth/oauth-provider`; don't also register `oauthProvider()`). It binds tokens to `MCP_RESOURCE` and serves RFC 9728 metadata.
- `cimd()` from `@better-auth/cimd` resolves CIMD clients with `metadataProfile: "mcp-2026-07-28"`. Its `@better-auth/cimd/node` transport pins DNS and refuses redirects; it works on Bun.
- Dynamic client registration is off. Turn on `allowDynamicClientRegistration` only if a client that matters can't connect without it.
- One scope, `tasks`, covers reading and writing tasks and reading tags.
- `mcpOfflineAccess()` (in `mcp.ts`) adds `offline_access` to every authorization that asks for `tasks`. Better Auth only issues refresh tokens for `offline_access`, but `mcp()` leaves it out of the scopes it advertises, so agents that request just `tasks` would otherwise have to reconnect every 15 minutes. Revoking still works at once through the consent check.
- `session.storeSessionInDatabase: true`: the OAuth provider links grants to session rows, so sessions are written to Postgres as well as Redis. Sessions created before this change exist only in Redis; the provider treats those users as signed out and sends them to `/login`, which shows the sign-in form during an OAuth flow (a `sig` query param) even when the app sees a session.
- `disabledPaths: ["/token"]` turns off `jwt()`'s session-to-JWT endpoint, which nothing uses.

### Discovery routes

RFC 8414 and RFC 9728 put metadata at the site root, outside `/api/auth`. `apps/web/src/app/.well-known/[...path]/route.ts` forwards every `/.well-known/*` request to `auth.handler`, which serves:

- `/.well-known/oauth-protected-resource/api/mcp`
- `/.well-known/oauth-authorization-server/api/auth`

OpenID discovery stays at `/api/auth/.well-known/openid-configuration`, which MCP clients don't need.

### Consent page

`apps/web/src/app/oauth/consent/page.tsx` verifies the signed query with `verifyOAuthQueryParams` on the server, loads the client's public name and logo, and lists what each scope allows. Allow and Cancel call `authClient.oauth2.consent`; `oauthProviderClient()` in the web auth client attaches the signed query.

### Revoking

JWT access tokens can't be revoked, so `/api/mcp` looks up the user's `oauth_consent` row for the token's client (`sub` + `azp`) on every request. **Settings → AI Agents** (`agents.list` / `agents.revoke` in `packages/api/src/routers/agents/`) deletes the consent and the client's refresh and access tokens in one transaction, so the agent's next request gets `401` and it can't refresh.

## Tools

`packages/api/src/mcp/tools.ts` defines the tools as oRPC procedures with `mcp.tool()` meta, registered on each request's `McpServer` by `McpRegistrar` from `@orpc/mcp`. Each one calls the app's own `tasks` / `tags` routers through `createRouterClient`, so validation, recurrence handling, realtime sync events, and rate limits are the same as in the apps.

| Tool | Does |
| --- | --- |
| `search_tasks` | Filters by text, status, start and due date ranges, and tags. Includes done tasks unless `status` says otherwise. Newest created first, at most 50, with `truncated: true` when more matched. |
| `get_task` | One task by ID. |
| `create_task` | Creates a task, or a whole series when given a `recurrence`. Returns the first occurrence and `createdCount`. |
| `update_task` | Changes only the given fields; `null` clears one. `scope` is `this` (default) or `following` for recurring tasks. |
| `delete_task` | Marked destructive so clients confirm first. Same `scope` as update. |
| `list_tags` | Tag IDs and names, for filtering and `tagIds`. |

Agents see a compact task shape (no user ID, series internals, or link metadata). They can't set links.

## Task filters

`tasks.list` accepts `params` with `query`, `status`, `startDateMin/Max`, `dueDateMin/Max`, `tagIds`, and `limit`. `TaskService.listTasks` turns them into one SQL query. `limit` is applied to tasks before the tag join, so tasks with several tags still count once. The apps still call `tasks.list()` with no params.

## Transport

`packages/api/src/mcp/handler.ts` uses `createMcpHandler` from the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). It serves the stateless 2026-07-28 protocol and, through the SDK's default `legacy: "stateless"`, 2025-era clients too. `GET` and `DELETE` return `405`.

## Local testing

Discovery and the flow need `NEXT_PUBLIC_WEB_URL` to match the URL the agent uses. Over plain HTTP, the resource must be on `localhost`. To exercise the whole flow without a real agent, create an `oauth_client` row (public, `token_endpoint_auth_method = 'none'`) linked to the resource in `oauth_client_resource`, then run authorize → consent → token with PKCE.
