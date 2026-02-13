# Tauri desktop release notes (current state)

This file captures the current state of the Tauri desktop release work,
the decisions made, and the remaining steps to ship a signed DMG with
auto-updates.

## Current state

- Desktop app is in `apps/web/src-tauri`.
- Bundle identifier is aligned with mobile: `com.nathancolosimo.kompose`.
- Tauri updater plugin is wired (Rust + JS), and a silent download +
  restart prompt is shown in the header once an update is ready.
- Update checks run on app launch and every 6 hours.
- Desktop window now launches non-maximized by default so drag-to-move
  behavior stays consistent with dev.
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
- Root cause identified: `frontendDist` pointed at `../.next` while stale
  `../.next/dev/cache/turbopack/*` files were present from dev runs.
  Tauri tried to embed those volatile cache files, causing:
  - intermittent "failed to read asset ... .next/dev/cache/... .sst" errors
  - very large embedded asset sets and repeated LLVM malformed-object failures
    in Rust release builds.

## Repo changes made

- `apps/web/src-tauri/tauri.conf.json`
  - `identifier`: `com.nathancolosimo.kompose`
  - `bundle.createUpdaterArtifacts`: `true`
  - `bundle.macOS.signingIdentity`: placeholder, now replaced manually
  - `plugins.updater.pubkey`: placeholder to be filled
  - `plugins.updater.endpoints`:
    `https://github.com/nathancolosimo/kompose/releases/latest/download/latest.json`

- `apps/web/src-tauri/src/lib.rs`
  - Added: `tauri_plugin_updater::Builder::new().build()`.
  - Added: `tauri_plugin_opener::init()` for system browser/file opens.
  - Removed release startup maximize fallback to avoid drag no-op issues
    when the window opens maximized.

- `apps/web/src/components/auth/social-account-buttons.tsx`
  - Social auth runs in-app across desktop and web.

- `apps/web/src-tauri/Cargo.toml`
  - Added: `tauri-plugin-updater = "2"`.
  - Added: `tauri-plugin-opener = "2"`.

- `apps/web/src-tauri/capabilities/default.json`
  - Added: `updater:default` permission.
  - Added: `opener:default` permission.
  - Removed `$schema` binding to avoid stale generated-schema validation
    false positives for plugin permissions.

- `apps/web/src/lib/tauri-desktop.ts`
  - Desktop runtime helper for Tauri detection and external URL opening.

- `apps/web/src/components/tauri-updater.tsx`
  - New provider: checks updates on launch + every 6 hours, downloads
    silently, exposes `isReadyToInstall` + `installUpdate()`.

- `apps/web/src/components/providers.tsx`
  - Wraps app in `TauriUpdaterProvider`.
  - `getSession` now uses `authClient.getSession({ query: { disableCookieCache: true } })` to force server session checks without Better Auth cookie-cache reads.
  - Added desktop bridge bootstrap:
    - intercepts external link clicks and opens them in system browser

- `apps/web/src/app/dashboard/settings/page.tsx`
  - Google account linking runs in-app across desktop and web.

- `apps/web/package.json`
  - Added: `@tauri-apps/plugin-opener`.

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

- `packages/state/src/config.ts`
  - Shared session query keeps `refetchOnMount: "always"` for fresh session truth when state hooks consume auth atoms.

- `apps/web/tsconfig.json`
  - Excluded `src-tauri/target/**` to avoid TS parsing generated files.

- `apps/web/.gitignore`
  - Added `.tauri.env` (local secret env file).

- `apps/web/.tauri.env.example`
  - Template env vars for signing + notarization.

- `apps/web/package.json`
  - Added script: `desktop:build:signed`.
  - Added script: `desktop:build:signed:universal`.
  - Added script: `build:desktop` (runs `scripts/build-desktop.sh`).

- `apps/web/scripts/build-desktop.sh`
  - Moves `src/app/api` and `src/app/docs` into a temp directory before build.
  - Uses shell `trap` handlers to always restore both directories on exit, including failure/interruption paths.
  - Clears `.next` + `out`, then runs `TAURI_BUILD=1 bun --bun next build`.

- `apps/web/next.config.mts`
  - Fumadocs MDX plugin is loaded only for non-Tauri builds.
  - `transpilePackages` no longer includes Shiki packages.

- `apps/web/src-tauri/tauri.conf.json`
  - `build.beforeBuildCommand`: `bun run build:desktop`
  - `build.removeUnusedCommands`: `true`

- `apps/web/src-tauri/Cargo.toml`
  - Added `profile.release` tuning:
    - `opt-level = "s"`
    - `lto = true`
    - `codegen-units = 1`
    - `panic = "abort"`
    - `strip = true`

## Local env file and build script

- Local env file (not committed): `apps/web/.tauri.env`
- Example template: `apps/web/.tauri.env.example`

Script:

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

## Notes

- The updater checks on launch and every 6 hours, downloads silently,
  and prompts for a restart when ready.
- Universal builds can use a single updater bundle in `latest.json`
  for both `darwin-aarch64` and `darwin-x86_64`.

## Manual no-notary flow (Apple Silicon)

This flow keeps code signing enabled but skips notarization so you can
produce a DMG for yourself and a few friends.

1) Build (signed, no notarization):

- `bun run desktop:build:signed:no-notary`

2) Release to GitHub (manual upload):

- `bun run desktop:release`

Artifacts uploaded:

- `apps/web/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg`
- `apps/web/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/*.app.tar.gz`
- `apps/web/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/*.app.tar.gz.sig`
- `apps/web/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/latest.json`

Intel users will need an `x86_64-apple-darwin` build or a universal build
if they need to run the app.
