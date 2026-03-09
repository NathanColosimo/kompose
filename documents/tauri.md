# Tauri desktop release notes (current state)

This file captures the current state of the Tauri desktop release work,
the decisions made, and the remaining steps to ship a signed DMG with
auto-updates.

## Current state

- Desktop app is in `apps/web/src-tauri`.
- Production desktop bundle identifier stays aligned with mobile:
  `com.nathancolosimo.kompose`.
- Local bundled testing now uses a separate desktop-dev flavor:
  `com.nathancolosimo.kompose.dev`.
- Tauri updater plugin is wired (Rust + JS), and a silent download +
  restart prompt is shown in the header once an update is ready.
- In production desktop builds, update checks run on app launch and every 6
  hours. Local/preview builds skip updater polling.
- Desktop window now launches non-maximized by default so drag-to-move
  behavior stays consistent with dev.
- Main window loads `/dashboard` directly (via `url` in window config)
  so logged-in users never see the marketing landing page. Unauthenticated
  users are redirected to `/login` by the dashboard auth guard.
- Drag regions are explicitly defined for dashboard header plus
  landing/auth pages so window dragging remains reliable.
- Desktop builds now exclude the `/docs` route and skip loading the
  Fumadocs MDX plugin.
- External HTTP(S) links clicked inside the desktop app are now opened in
  the system browser (meeting links, maps links, and other third-party URLs).
- Logout now clears in-memory query cache and auth route guards wait for
  settled session revalidation before redirecting.
- Logout now routes directly to `/login` after sign-out and cache clear.
- Updater config points to GitHub Releases `latest.json`.
- A `.tauri.env` workflow exists for local signing/notarization builds.
- Apple Silicon DMG build now succeeds with the standard Cargo defaults.
- OAuth sign-in and account linking now open in the system browser and
  redirect back to the desktop app via a flavor-specific deep link:
  `kompose://` for production and `kompose-dev://` for desktop-dev.
- Local bundled desktop testing now uses `bun run desktop:build:dev`, which
  builds an unsigned `Kompose Dev` app without replacing the installed
  production app.
- Command bar now supports a desktop global shortcut that toggles a
  dedicated compact popup window (`/desktop/command-bar`) without focusing
  the full dashboard window.
- Command bar popup auto-hides on focus loss (click-away), and on macOS uses a
  rounded native HUD vibrancy treatment so the frameless popup matches the
  softer system window feel better.
- Command bar shortcut presets are persisted in desktop settings store.
- Better Auth last-login-method remains client cookie/storage based; in
  Tauri desktop this is best-effort because auth itself uses bearer tokens
  instead of relying on cross-origin cookies.
- Root cause identified: `frontendDist` pointed at `../.next` while stale
  `../.next/dev/cache/turbopack/*` files were present from dev runs.
  Tauri tried to embed those volatile cache files, causing:
  - intermittent "failed to read asset ... .next/dev/cache/... .sst" errors
  - very large embedded asset sets and repeated LLVM malformed-object failures
    in Rust release builds.

## Repo changes made

- `apps/web/src-tauri/tauri.conf.json`
  - `app.macOSPrivateApi`: `true` (required for the macOS command-bar popup's
    transparent native window + vibrancy treatment)
  - `identifier`: `com.nathancolosimo.kompose`
  - `bundle.createUpdaterArtifacts`: `true`
  - `bundle.macOS.signingIdentity`:
    `Developer ID Application: Nathan Colosimo (B8R99NL6HM)`
  - `plugins.updater.pubkey`: placeholder to be filled
  - `plugins.updater.endpoints`:
    `https://github.com/nathancolosimo/kompose/releases/latest/download/latest.json`

- `apps/web/src-tauri/tauri.desktop-dev.conf.json`
  - `productName`: `Kompose Dev`
  - `identifier`: `com.nathancolosimo.kompose.dev`
  - `bundle.createUpdaterArtifacts`: `false`
  - `plugins.deep-link.desktop.schemes`: `["kompose-dev"]`

- `apps/web/src-tauri/src/lib.rs`
  - Added: `tauri_plugin_updater::Builder::new().build()`.
  - Added: `tauri_plugin_opener::init()` for system browser/file opens.
  - Added: `tauri_plugin_deep_link::init()` for desktop deep link handling.
  - Added: `tauri_plugin_global_shortcut` handler for command bar toggle.
  - Added: hidden `command-bar` WebView window creation (`/desktop/command-bar`).
  - Added: macOS-only transparent `command-bar` window shell plus rounded
    `window-vibrancy` HUD material so the popup keeps soft corners.
  - Added: blur/focus-loss hide behavior for the `command-bar` popup.
  - Added: Tauri command `set_command_bar_shortcut_preset` for runtime
    unregister/register of selected preset.
  - Added: Tauri command `dismiss_command_bar` for programmatic dismissal
    that restores focus to the previously active app on macOS (uses
    `[NSApp hide:nil]` to avoid a flicker of the main window).
  - Added: macOS-only `get_frontmost_app_pid()` and `hide_app()` helpers
    (via `objc` crate) for focus management.
  - Deep link URLs are logged on startup and at runtime via `on_open_url`.
  - Removed release startup maximize fallback to avoid drag no-op issues
    when the window opens maximized.

- `apps/web/src/components/auth/social-account-buttons.tsx`
  - On Tauri desktop, sign-in opens the system browser via `openDesktopOAuth`
    instead of running the OAuth flow inside the webview.
  - Web flow is unchanged.

- `apps/web/src-tauri/Cargo.toml`
  - `tauri` dependency enables `macos-private-api` for the rounded macOS
    command-bar popup treatment.
  - Added: `tauri-plugin-deep-link = "2"`.
  - Added: `tauri-plugin-store = "2"`.
  - Added: `tauri-plugin-updater = "2"`.
  - Added: `tauri-plugin-opener = "2"`.
  - Added: `tauri-plugin-global-shortcut`.
  - Added: `window-vibrancy = "0.7.1"` (macOS target only).
  - Added: `objc = "0.2"` (macOS-only) for native focus management.

- `apps/web/src-tauri/capabilities/default.json`
  - `windows`: includes both `main` and `command-bar` so the popup
    window has access to Store, core APIs, etc. (required for auth
    bearer token and authenticated queries like tags/tasks).
  - Added: `deep-link:default` permission.
  - Added: `store:default` permission.
  - Added: `updater:default` permission.
  - Added: `opener:default` permission.
  - Added: `global-shortcut:allow-register`.
  - Added: `global-shortcut:allow-unregister`.
  - Added: `global-shortcut:allow-is-registered`.
  - Added: `core:window:allow-set-size`, `core:window:allow-center`,
    `core:window:allow-hide`, `core:window:allow-show` for the
    `command-bar` window auto-sizing.
  - Capability file is schema-bound via
    `../gen/schemas/desktop-schema.json`.

- `apps/web/src/lib/tauri-desktop.ts`
  - Desktop runtime helper for Tauri detection and external URL opening.
  - Added: `openDesktopOAuth(provider, mode, baseUrl)` helper that opens
    the system browser to the desktop-sign-in endpoint for OAuth and forwards
    the active desktop scheme.
  - Added: command bar shortcut preset model + store helpers.
  - Added: `applyDesktopCommandBarShortcutPreset()` and
    `syncDesktopCommandBarShortcutPreset()` for runtime rebind.

- `apps/web/src/lib/desktop-deep-link.ts`
  - Shared helper that builds the desktop callback URL from the typed scheme.
  - The scheme itself now comes from required env validation in
    `packages/env/src/index.ts` (`NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME` with
    enum values `kompose | kompose-dev`).

- `apps/web/src/components/tauri-updater.tsx`
  - New provider: in production desktop builds, checks updates on launch +
    every 6 hours, downloads silently, exposes `isReadyToInstall` +
    `installUpdate()`.

- `apps/web/src/components/providers.tsx`
  - Wraps app in `TauriUpdaterProvider`.
  - `getSession` now uses `authClient.getSession({ query: { disableCookieCache: true } })` to force server session checks without Better Auth cookie-cache reads.
  - Added desktop bridge bootstrap:
    - intercepts external link clicks and opens them in system browser
    - syncs persisted command-bar shortcut preset on startup
  - Added `DeepLinkHandler` component for flavor-aware desktop deep link
    processing.

- `apps/web/src/components/deep-link-handler.tsx`
  - Listens for `<scheme>://auth/callback?token=TOKEN` deep links via
    `@tauri-apps/plugin-deep-link` JS API.
  - On receiving a token, verifies it via `authClient.oneTimeToken.verify()`.
    The bearer plugin captures the session token from the `set-auth-token`
    response header and persists it to Tauri Store. All subsequent requests
    use this bearer token via the Authorization header.
  - Invalidates React Query caches and navigates to `/dashboard` via
    client-side routing (no page reload).

- `apps/web/src/app/dashboard/settings/page.tsx`
  - On Tauri desktop, account linking opens the system browser via
    `openDesktopOAuth` with `mode: "link"` instead of running in-webview.
  - Desktop shortcut settings extracted to
    `desktop-shortcut-settings.tsx` (co-located).
  - Web flow is unchanged.

- `apps/web/src/app/dashboard/settings/desktop-shortcut-settings.tsx`
  - Self-contained component for the desktop command bar shortcut preset
    picker (5 preset options) with `react-hook-form`, persistence, and
    runtime re-registration.

- `apps/web/src/app/api/auth/desktop-sign-in/route.ts`
  - GET endpoint that initiates OAuth in the system browser.
  - Proxies to Better Auth sign-in or link-social endpoint internally.
  - Preserves the requested desktop scheme in the callback URL so browser auth
    returns to the correct installed app flavor.
  - Forwards state cookies and returns a 302 redirect to the OAuth provider.

- `apps/web/src/app/api/auth/desktop-callback/route.ts`
  - GET endpoint called by the browser after OAuth completes.
  - Generates a one-time token via the `oneTimeToken` plugin and
    redirects to the matching desktop scheme callback (`kompose://...` or
    `kompose-dev://...`).

- `packages/auth/src/index.ts`
  - Added Better Auth `bearer()` plugin so the server accepts
    `Authorization: Bearer` tokens in addition to cookies. This allows
    Tauri desktop to authenticate without cookies (bypassing WKWebView
    ITP which blocks cross-origin `Set-Cookie`).
  - Added Better Auth `lastLoginMethod()` plugin for client-side "last used"
    provider hints.
  - Trusted origins now include both desktop custom schemes.

- `apps/web/package.json`
  - Added: `@tauri-apps/plugin-opener`.
  - Added: `@tauri-apps/plugin-deep-link`.
  - Added: `@tauri-apps/plugin-global-shortcut`.

- `apps/web/src/components/app-header.tsx`
  - Added restart button with red dot when update is ready.
  - Updated drag handling to use a full-header `data-tauri-drag-region` layer
    behind controls, with pointer-events isolation so controls remain interactive.
  - Logout now waits for sign-out, forces `getSession({ disableCookieCache: true })`, clears client query cache, then redirects to `/login`.

- `apps/web/src/app/page.tsx`
  - Added top drag strip so landing page can drag the Tauri window.

- `apps/web/src/app/login/page.tsx`
  - Added top drag strip so sign-in/sign-up page can drag the Tauri window.
  - Login route guard now uses direct `authClient.getSession({ disableCookieCache: true })` before deciding redirect.

- `apps/web/src/app/dashboard/layout.tsx`
  - Dashboard auth guard now uses direct `authClient.getSession({ disableCookieCache: true })` before deciding to render or redirect.

- `apps/web/src/app/desktop/command-bar/page.tsx`
  - Dedicated command bar popup route for the Tauri `command-bar` window.
  - Renders the same `CommandBarContent` used on web so behavior is
    identical -- no custom scroll modes or layout wrappers.
  - The window is undecorated and auto-sizes to exactly fit the dialog
    content via `ResizeObserver` (up to `COMMAND_BAR_MAX_HEIGHT`).
  - Tauri API imports are cached per effect lifecycle to avoid
    re-importing on every resize event.
  - Hides popup when command state closes (via `dismiss_command_bar`
    Rust command for flicker-free focus restoration on macOS) and
    reopens state on window focus.

- `apps/web/src/app/desktop/command-bar/layout.tsx`
  - Keeps the popup route shell transparent so the native macOS HUD material
    shows through around the rounded command surface.

- `packages/state/src/config.ts`
  - Shared session query keeps `refetchOnMount: "always"` for fresh session truth when state hooks consume auth atoms.

- `apps/web/tsconfig.json`
  - Excluded `src-tauri/target/**` to avoid TS parsing generated files.

- `apps/web/.gitignore`
  - Added `.tauri.env` and `.tauri.dev.env` (local secret env files).

- `apps/web/.tauri.env.example`
  - Template env vars for signing + notarization.

- `apps/web/.tauri.dev.env.example`
  - Template env vars for the local unsigned desktop-dev build.

- `apps/web/package.json`
  - Added script: `desktop:build:dev`.
  - Added script: `desktop:build:signed`.
  - Added script: `desktop:build:signed:universal`.
  - Added script: `build:desktop` (runs `scripts/build-desktop.sh`).

- `apps/web/scripts/build-desktop.sh`
  - Moves `src/app/api` and `src/app/docs` into a temp directory before build.
  - Uses shell `trap` handlers to always restore both directories on exit, including failure/interruption paths.
  - Clears `.next` + `out`, then runs `TAURI_BUILD=1 bun ./node_modules/next/dist/bin/next build`.

- `apps/web/scripts/build-desktop-dev.sh`
  - Backs up `src-tauri/icons`, generates a temporary light icon set from
    `src-tauri/icons/kompose-icon-light.png`, loads `.tauri.dev.env`, builds the unsigned desktop-dev
    flavor, and restores the production icons on exit.

- `apps/web/next.config.mts`
  - Fumadocs MDX plugin is loaded only for non-Tauri builds.
  - `transpilePackages` no longer includes Shiki packages.

- `apps/web/src-tauri/tauri.conf.json`
  - `plugins.deep-link.desktop.schemes`: `["kompose"]`
  - `build.beforeBuildCommand`: `bun run build:desktop`
  - `build.removeUnusedCommands`: `true`

- `apps/web/src-tauri/Cargo.toml`
  - Added `profile.release` tuning:
    - `opt-level = "s"`
    - `lto = true`
    - `codegen-units = 1`
    - `panic = "abort"`
    - `strip = true`

## Local env files and build script

- Web/local runtime env file (not committed): `apps/web/.env.local`
  - add `NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME=kompose`
- Signed desktop build env file (not committed): `apps/web/.tauri.env`
  - add `NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME=kompose`
- Desktop-dev build env file (not committed): `apps/web/.tauri.dev.env`
  - add:
    - `NEXT_PUBLIC_WEB_URL=http://localhost:3000`
    - `NEXT_PUBLIC_DEPLOYMENT_ENV=local`
    - `NEXT_PUBLIC_DESKTOP_DEEP_LINK_SCHEME=kompose-dev`
- Example templates:
  - `apps/web/.env.example`
  - `apps/web/.tauri.env.example`
  - `apps/web/.tauri.dev.env.example`

Scripts:

- `desktop:build:dev`:
  - backs up the current generated icons
  - runs `tauri icon src-tauri/icons/kompose-icon-light.png`
  - builds the unsigned desktop-dev flavor with `kompose-dev://`
    as both an `.app` and a drag-install `.dmg`
  - restores the production icons after the build finishes

- `desktop:build:signed`:
  `set -a && . ./.tauri.env && set +a && bunx tauri build --bundles dmg --target aarch64-apple-darwin`

- `desktop:build:signed:universal`:
  `set -a && . ./.tauri.env && set +a && bunx tauri build --bundles dmg --target universal-apple-darwin`

## Tauri updater keys

- Public key is safe to commit in `tauri.conf.json`.
- Private key must stay local. Exposed via:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if set)

## Code signing and notarization

- For DMG distribution, the correct cert is:
  `Developer ID Application: Nathan Colosimo (B8R99NL6HM)`.
- This is different from Apple Development or iOS Distribution.
- Notarization env vars (App Store Connect API key method):
  - `APPLE_API_ISSUER`
  - `APPLE_API_KEY`
  - `APPLE_API_KEY_PATH`

## Build commands tried

Universal (slow / memory heavy):

- `bunx tauri build --bundles dmg --target universal-apple-darwin`
- Usually hangs at: `Building [=======================> ] 525/527: kompose`
  then fails with an LLVM "truncated or malformed object" error.
- "   Compiling minisign-verify v0.2.4
error: failed to build archive at `/Users/nathancolosimo/Documents/kompose/apps/web/src-tauri/target/aarch64-apple-darwin/release/deps/libkompose_lib.rlib`: LLVM error: truncated or malformed object (string table at offset 3406769960 with a size of 8, overlaps section contents at offset 312 with a size of 7701736940)

error: could not compile `kompose` (lib) due to 1 previous error
failed to build app: failed to build app
       Error failed to build app: failed to build app" is the error message.

Per-arch (Apple Silicon):

- `bunx tauri build --bundles dmg --target aarch64-apple-darwin`
- Current result: compiles, signs app + DMG, emits `.dmg` successfully.

## Current blocker

- Compile and DMG bundling blocker is resolved for Apple Silicon target.
- Remaining risk is Apple notary queue latency (`In Progress` for long periods).
- Notarization can also be skipped when Apple env vars are not present in the
  shell (`APPLE_*`).

## Notarization queue notes

- As of `2026-02-06`, a submission remained in `In Progress` for ~5 hours:
  `36f5374a-6595-4f7e-8c84-98872df2b5e6`.
- A second manual submission was created:
  `fccfbf92-0d7a-438a-931b-36ff04c3cc7c` (also initially `In Progress`).
- Apple developer status feed reported no active event for
  `Developer ID Notary Service` at that time.

## Deep link OAuth flow

OAuth sign-in and account linking on Tauri desktop open in the system
browser instead of running inside the webview. The flow uses a one-time
token exchange to bridge the browser session to the Tauri webview.

### Sign-in flow

1. User clicks "Sign in with Google" in the Tauri app.
2. App opens the system browser to
   `GET /api/auth/desktop-sign-in?provider=google`.
   The desktop app also includes its active scheme (`kompose` or
   `kompose-dev`) so the callback returns to the correct installed flavor.
3. Server proxies to Better Auth's sign-in social endpoint, gets the
   Google auth URL, forwards state cookies, and returns a 302 redirect.
4. Browser follows the Google OAuth flow.
5. Google redirects back to Better Auth callback; Better Auth creates a
   session and sets the session cookie in the browser.
6. Better Auth redirects to `/api/auth/desktop-callback`.
7. Desktop callback generates a one-time token via the `oneTimeToken`
   plugin (stored in the `verification` table, 3-minute TTL) and
   redirects to the matching desktop scheme callback.
8. macOS opens/focuses the Tauri app with the deep link.
9. `DeepLinkHandler` captures the URL and calls
   `authClient.oneTimeToken.verify({ token })` via cross-origin fetch.
10. The server verifies the token and returns the session. The bearer
    plugin includes a `set-auth-token` response header containing the
    session token.
11. The auth client's global `onSuccess` handler (configured in
    `auth-client.ts`) captures this header and persists the bearer token
    to Tauri Store (via in-memory cache + async IPC write).
12. The handler invalidates React Query caches and navigates to
    `/dashboard` via client-side routing (no page reload).
13. All subsequent requests (auth client + ORPC) include the bearer
    token via `Authorization: Bearer` header, bypassing cookies entirely.

### Account linking flow

Same as sign-in but with an extra step: the Tauri app first generates a
one-time token via `authClient.oneTimeToken.generate()` (using its
bearer token for authentication), then opens the browser to
`GET /api/auth/desktop-sign-in?provider=google&mode=link&link_token=TOKEN`.
The server verifies the token via the `oneTimeToken` plugin and proxies
to Better Auth's link-social endpoint with the recovered session.

### Plugins

- `tauri-plugin-deep-link` (Rust + JS) registers the bundled app's custom URL
  scheme. Production uses `kompose://`; desktop-dev uses `kompose-dev://`.
  Configured via `tauri.conf.json` plus the desktop-dev override config.

### Security

- One-time tokens are managed by Better Auth's `oneTimeToken` plugin,
  stored in the `verification` table with a 3-minute TTL and consumed
  (deleted) after a single use.
- Link tokens require an authenticated session to create.
- Tauri desktop uses **bearer tokens** (Authorization header) instead of
  cookies. This bypasses WKWebView's ITP which blocks cross-origin
  `Set-Cookie`. The bearer token is persisted in **Tauri Store**
  (`tauri-plugin-store`), which stores data in the app's data directory
  via Rust IPC -- not in the webview's `localStorage`. An in-memory
  cache provides synchronous reads required by Better Auth's token
  callback, loaded from Tauri Store on app startup.
- The web app continues to use HttpOnly cookies unchanged.
- Logout clears the bearer token from memory and Tauri Store before
  sign-out.

### macOS testing caveat

Deep links on macOS only work with the bundled `.app` installed in
`/Applications`. They cannot be tested in `tauri dev` mode. For
development, the fallback in-webview flow still works (the desktop
detection only triggers `openDesktopOAuth` when `isTauriRuntime()` is
true in a bundled build). For side-by-side local testing of the real OAuth
callback flow, use `bun run desktop:build:dev` and install `Kompose Dev.app`.

### Future: Linux/Windows

On Linux and Windows, deep links are delivered as command-line arguments
to a new app process. The `tauri-plugin-single-instance` plugin should
be added to forward deep links to the existing instance instead of
launching a second one. This is not needed on macOS where the OS handles
single-instance natively for deep links.

## Notes

- The updater checks on launch and every 6 hours, downloads silently,
  and prompts for a restart when ready.
- Universal builds can use a single updater bundle in `latest.json`
  for both `darwin-aarch64` and `darwin-x86_64`.

## Root production flow

The monorepo now has root production orchestration commands:

- `bun run build:prod`
- `bun run submit:prod`

These commands run Turborepo tasks for both app workspaces:

- `web`
- `native`

Desktop behavior in this flow:

- `build:prod` runs web phases in this order:
  - `web#build:prod:desktop`
  - `web#build:prod`

- `web#build:prod:desktop` executes:
  - `bun run desktop:build:signed`
- `web#build:prod` executes:
  - `bun run --cwd ../.. vercel:build:prod:raw` (runs Vercel CLI from repo root)
- `desktop:build:signed` is the full signed + notarized path (it reads
  `apps/web/.tauri.env` and uses `APPLE_*` notarization env vars).
- `submit:prod` runs `web#submit:prod`, which executes:
  - `cd ../.. && vercel deploy --prebuilt --prod` (runs Vercel CLI from
    repo root).
  - Turbo wires `web#submit:prod` to depend on `web#build:prod`, so the
    deploy step always runs after a prebuilt web artifact exists and that
    prebuild can still be reused from Turbo cache.
  - `bun run desktop:release`
- `submit:prod` itself is not cached because deployment has side effects,
  but the dependent `web#build:prod` task can still be restored from cache
  when inputs have not changed.

`desktop:release` remains upload-only and now fails fast when expected
artifacts are missing or ambiguous (for example stale duplicate
`.dmg`/`.app.tar.gz` files).

## Local desktop-dev flow (Apple Silicon)

Use this when you want to test the bundled desktop app locally without
replacing the installed production app.

1. Build the unsigned desktop-dev flavor:

- `bun run desktop:build:dev`

2. Open the generated DMG from
   `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`.

3. Drag `Kompose Dev.app` into `/Applications`.

Result:

- Production `Kompose.app` keeps the `kompose://` scheme.
- Local `Kompose Dev.app` uses `kompose-dev://`.
- The build temporarily swaps in the light icon set, then restores the
  production icons after the build completes.
