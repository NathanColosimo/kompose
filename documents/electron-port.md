# Electron desktop

`apps/electron` is a thin shell around the hosted web app. Its windows load
`https://kompose.dev` (the dashboard and `/desktop/command-bar`), so the desktop
UI always matches the web deploy. Chromium's HTTP and code caches keep the
hashed Next.js chunks on disk between launches; only the HTML is fetched. If the
server can't be reached, the window shows a retry page that also reloads once
the network returns.

The main process owns the native parts: the command bar popup, global
shortcuts, browser sign-in, and updates. `packages/desktop` defines the preload
bridge (`window.komposeDesktop`) that the web app uses for them.

## Run and package

Start the web app as usual (`bun run portless:proxy`, `bun run db:start`,
`bun run dev:web`), then `bun run dev:desktop`. Development windows load
`https://local.kompose.dev` with hot reload; set `KOMPOSE_SERVER_URL` to use
another server. Packaged builds always load `https://kompose.dev`. Main
trusts the macOS keychain in addition to Node's CA list, so the portless
development certificate works without extra setup.

`bun run package:desktop` creates an unsigned, unpacked Apple Silicon app in
`apps/electron/release/mac-arm64` for local testing. Development runs use a
separate `Kompose Dev` profile, so they never share a session with a release.

## Bridge compatibility

Installed apps keep their preload until they update, while the web app always
ships the latest code. Only add bridge members, and feature-detect new ones in
the web app. Removing or changing one needs a desktop release that every user
has installed first.

## Releases

Desktop releases are only needed for main-process or preload changes; UI changes
ship with the web deploy.

Releases ship as **Kompose** with the Tauri app's bundle ID
(`com.nathancolosimo.kompose`): installing the DMG replaces the Tauri app in
`/Applications`. Users sign in once, because the Electron profile is new.
Existing Tauri installs do not auto-update to Electron; they need the new DMG.
Builds are Apple Silicon (arm64) only.

Policy:

- Releases run in CI (`.github/workflows/release.yml`, see
  `documents/ci-cd.md`) after the web deploy, because the desktop app needs the
  server's auth plugin.
- A release is only built when the shell changed: the workflow hashes the built
  main/preload bundles, `electron-builder.yml`, `build/`, and the Electron
  package versions, and skips the release if a `desktop-fp/<hash>` tag already
  exists. Web-only changes reach desktop users without a new binary.
- The version is the next patch after the latest `v*` tag (tags continue the
  Tauri numbering; the last Tauri release is `v0.1.121`). It is injected at
  build time, so `version` in `apps/electron/package.json` is not bumped.
- A release publishes immediately and becomes GitHub's **Latest** release.
  Installed apps check it every 30 minutes (electron-updater, `latest-mac.yml`)
  and download updates in the background. The web app then offers a restart;
  otherwise the update installs on the next quit.

The workflow signs with the `Developer ID Application: Nathan Colosimo
(B8R99NL6HM)` certificate (`CSC_LINK`), notarizes with an App Store Connect API
key, staples the app, and verifies it with `codesign`, `stapler`, and
Gatekeeper before it pushes the tag and creates the release with the DMG, the
update zip and its blockmap, and `latest-mac.yml`. If the upload fails after the
tag is pushed, delete the partial release and tag
(`gh release delete vX --cleanup-tag`) and rerun the workflow.

To check packaging locally without signing, run `bun run package:desktop`.

## Authentication

Google blocks OAuth inside embedded browsers, so sign-in runs in the system
browser through the Better Auth Electron plugin. The login page calls
`window.requestAuth`; the browser completes OAuth, and the browser-side
`electronProxyClient` returns a PKCE code through the
`com.nathancolosimo.kompose:` URL scheme. Main exchanges it at `/electron/token`,
copies the returned session cookies into the windows' cookie store, and reloads
the main window. From then on the windows are ordinary same-origin web pages:
sessions refresh and sign out exactly as on the web.

Account linking opens the normal settings page in the browser and uses Better
Auth's standard `linkSocial`, including WHOOP's generic provider. Use the same
Kompose account in that browser; linked accounts refresh when the app regains
focus.

## Process boundaries

Windows use context isolation, sandboxing, and no Node integration. Bridge calls
are accepted only from the app origin's main frame. Navigation to other origins,
and every new window, opens in the system browser instead. Permission requests
are denied.

The command popup loads hidden at startup and stays loaded, so the shortcut opens it instantly.
It is available from the global shortcut and File → Open Command Bar.
The main window reopens where it was last closed, and the popup reopens where it
was last dragged when that spot is on the display under the cursor. Both are
clamped into the display's work area. The popup's height follows its content;
growth near the bottom edge shifts it up until it shrinks again.
