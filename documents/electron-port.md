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

Desktop export builds a temporary sibling copy of the web app, excluding server
and docs routes there (the build helper requires Bash and rsync). Its generated
files and incremental cache are separate
from the web build, so it can run alongside `next dev` or the normal web build.
Successful exports replace `apps/web/out`; failed builds keep the previous export.

`bun run package:desktop` creates an unsigned, unpacked Apple Silicon app in
`apps/electron/release/mac-arm64` for local testing. Development runs use a
separate `Kompose Dev` profile, so they never share a session with a release.

## Releases

Releases ship as **Kompose** with the Tauri app's bundle ID
(`com.nathancolosimo.kompose`): installing the DMG replaces the Tauri app in
`/Applications`. Users sign in once, because the Electron auth profile is new.
Existing Tauri installs do not auto-update to Electron; they need the new DMG.
Builds are Apple Silicon (arm64) only.

Policy:

- Releases are built on your Apple Silicon Mac from a clean `main` that matches
  `origin/main`, never from CI.
- Every release bumps `version` in `apps/electron/package.json`; tags are
  `v<version>` and continue the Tauri numbering (the last Tauri release is
  `v0.1.121`).
- A release publishes immediately and becomes GitHub's **Latest** release.
  Installed apps poll it every 30 minutes (electron-updater, `latest-mac.yml`),
  so a published release reaches every user. Downgrades are disabled.

Setup (once):

1. Keep the `Developer ID Application: Nathan Colosimo (B8R99NL6HM)`
   certificate in your login keychain.
2. Copy `apps/electron/.env.release.example` to `.env.release`. The variables
   from the old `apps/web/.tauri.env` map as follows:

   | Tauri (`.tauri.env`)                  | Electron (`.env.release`)    |
   | ------------------------------------- | ---------------------------- |
   | `APPLE_API_KEY_PATH`                  | `APPLE_API_KEY` (`.p8` path) |
   | `APPLE_API_KEY` (key ID)              | `APPLE_API_KEY_ID`           |
   | `APPLE_API_ISSUER`                    | `APPLE_API_ISSUER`           |
   | `NEXT_PUBLIC_WEB_URL`                 | `KOMPOSE_RELEASE_SERVER_URL` |
   | `NEXT_PUBLIC_DEPLOYMENT_ENV`          | always `production`          |
   | `NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME`| removed                      |
   | `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`| removed (macOS code signing) |

3. `gh auth login` with push access to `NathanColosimo/kompose`.

Release: bump the version, merge to `main`, deploy the web server first (the
desktop app needs its auth plugin), then run `bun run submit:prod:desktop`. The
script checks everything before building; it builds the renderer and main
process against `KOMPOSE_RELEASE_SERVER_URL`. It then signs, notarizes, and
staples the app, verifies it with `codesign`, `stapler`, and Gatekeeper, and
only then pushes the tag and creates the release. The release uploads the DMG,
the update zip and its blockmap, and `latest-mac.yml`. If the upload fails after the tag is
pushed, delete the partial release and tag (`gh release delete vX --cleanup-tag`)
and rerun.

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
notifications. Channel names live in `packages/desktop`, and main validates every
renderer-supplied argument before acting on it. The dashboard renderer is shared with the web app.

## Validation

Boundary tests cover asset traversal, trusted origins, external URL schemes,
session redaction, and response header filtering. Run `bun run type-check`,
`cd apps/electron && bun run test`, and `bun run build:desktop`.
A packaged browser sign-in/account-link round trip and signed update install need
separate end-to-end verification; a renderer build alone does not verify them.

References: [Better Auth Electron](https://better-auth.com/docs/integrations/electron),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
