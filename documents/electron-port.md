# Electron desktop

`apps/electron` owns the main process and sandboxed preload. The existing Next.js
static export, React components, Jotai state, TanStack Query cache, and oRPC
subscriptions run in Chromium. `packages/desktop` defines the serializable
interface for windows, shortcuts, external links, and updates.

## Run and package

Install with `bun install` and configure `apps/web/.env`. Start Postgres and Redis
with `bun run db:start` (Docker through OrbStack on macOS). Start the web API with
`bun run dev:web`. The configured Google callback domain must route to that server;
for `https://local.kompose.dev`, start the trusted HTTPS proxy with
`bun run portless:proxy` first.

Run `bun run build:desktop`, then `bun run dev:desktop`. The API defaults to
`https://kompose.dev`; set `KOMPOSE_SERVER_URL` for a local API. For renderer hot
reload, also set `KOMPOSE_RENDERER_URL` to the local web server. Packaged API targets
use `MAIN_VITE_SERVER_URL` at build time. Set `NEXT_PUBLIC_WEB_URL` to the same API
when building the renderer. The server must include this branch's Electron plugin.

`bun run package:desktop` creates an unpacked application. For unsigned local macOS
packaging, use `cd apps/electron && bunx electron-builder --dir --publish never
-c.mac.identity=null -c.mac.notarize=false` (one command). Release builds require
signing/notarization credentials. The Electron app has its own application ID,
auth profile, and update channel; it does not overwrite the previous app's session.

## Authentication

The official Better Auth Electron plugin owns browser OAuth, PKCE, deep links,
session exchange, encrypted safeStorage cookies, and preload auth methods.
`setupMain()` runs before app readiness; `setupRenderer()` is bundled in the
sandboxed preload. Sign-in uses `requestAuth`, and sign-out uses `signOut`.
The browser uses `electronProxyClient`, preserves PKCE parameters, and calls
`ensureElectronRedirect` or `transferUser` for an existing browser session.

Account linking opens the normal browser settings page and uses Better Auth's
standard `linkSocial` endpoint, including for WHOOP's generic provider. Use the
same Kompose account in that browser. Linked accounts refresh on returning to the
app. This avoids transporting browser OAuth state cookies or session tokens
through a bespoke desktop callback. The old bearer and one-time-token plugins,
custom desktop auth endpoints, Tauri runtime, and Tauri build/release scripts are
removed.

## Process boundaries

Renderer API requests go through `kompose-app://app/api/...`. Main attaches the
plugin's cookie to a fixed API origin and strips credentials from responses.
Session responses omit tokens, IP addresses, and user agents. oRPC subscriptions
stream without buffering. Static assets use a registered secure app protocol.
Windows use context isolation, sandboxing, no Node integration, restricted IPC,
and external navigation through the system browser.

The command popup is created on first use and released after 60 seconds hidden.
App-specific IPC covers the window/shortcut/update operations and query refresh
notifications. The dashboard renderer is shared with the web app.

## Validation

Boundary tests cover asset traversal, trusted origins, external URL schemes,
session redaction, and response header filtering. Run `bun run type-check`,
`cd apps/electron && bun run test`, and `bun run build:desktop`.
A packaged browser sign-in/account-link round trip and signed update install need
separate end-to-end verification; a renderer build alone does not verify them.

References: [Better Auth Electron](https://better-auth.com/docs/integrations/electron),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
