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
another server. Packaged builds always load `https://kompose.dev`. Sign-in's
token exchange runs in main's Node runtime, so for local HTTPS launch with
`NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem"` to trust the development CA.

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

- Releases are built on your Apple Silicon Mac from a clean `main` that matches
  `origin/main`, never from CI.
- Every release bumps `version` in `apps/electron/package.json`; tags are
  `v<version>` and continue the Tauri numbering (the last Tauri release is
  `v0.1.121`).
- A release publishes immediately and becomes GitHub's **Latest** release.
  Installed apps check it every 30 minutes (electron-updater, `latest-mac.yml`)
  and download updates in the background. The web app then offers a restart;
  otherwise the update installs on the next quit.

Setup (once):

1. Keep the `Developer ID Application: Nathan Colosimo (B8R99NL6HM)`
   certificate in your login keychain.
2. Copy `apps/electron/.env.release.example` to `.env.release`. The variables
   from the old `apps/web/.tauri.env` map as follows:

   | Tauri (`.tauri.env`)                   | Electron (`.env.release`)    |
   | -------------------------------------- | ---------------------------- |
   | `APPLE_API_KEY_PATH`                   | `APPLE_API_KEY` (`.p8` path) |
   | `APPLE_API_KEY` (key ID)               | `APPLE_API_KEY_ID`           |
   | `APPLE_API_ISSUER`                     | `APPLE_API_ISSUER`           |
   | `NEXT_PUBLIC_*`                        | removed (UI is hosted)       |
   | `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]` | removed (macOS code signing) |

3. `gh auth login` with push access to `NathanColosimo/kompose`.

Release: bump the version, merge to `main`, deploy the web server first (the
desktop app needs its auth plugin), then run `bun run submit:prod:desktop`. The
script checks everything before building, then builds, signs, notarizes, and
staples the app. It verifies the result with `codesign`, `stapler`, and
Gatekeeper, and only then pushes the tag and creates the release with the DMG,
the update zip and its blockmap, and `latest-mac.yml`. If the upload fails after
the tag is pushed, delete the partial release and tag
(`gh release delete vX --cleanup-tag`) and rerun.

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

The command popup is created on first use and released after 60 seconds hidden.
It is available from the global shortcut and File → Open Command Bar.
The main-process settings store remembers the main window's normal bounds and
maximized state (saved after movement/resizing and on close) and where the user
last dragged the popup. Restoring clamps bounds to an available display's work
area. The popup opens on the display under the cursor, at its remembered spot
when that spot is on this display. Its height follows its content; growth near
the bottom edge shifts it up temporarily, and it returns to its anchor when it
shrinks.

## UI review checklist

- Google palettes stay cached for 24 hours, including while a calendar is unmounted;
  normalization reuses the same objects instead of rebuilding colors on query updates.
- The red now line uses the displayed timezone, changes columns at midnight, and
  refreshes on returning to the app. The highlighted date follows the same clock.
- Calendar visibility preferences survive failed account reads and signed-out states.
- Responsive day capacity uses the actual 64px gutter and clamped sidebar width.
  The time labels sync to an already-scrolled grid when they mount.
- The toolbar wraps at the 720px minimum window width without clipping controls.
  Toolbar buttons and arrow-key navigation use the same rendered day count, so
  responsive layouts do not skip dates. Period buttons have accessible labels.
- Today and the `T` shortcut return to today's date and immediately scroll the
  current-time line into view, including when today is already selected. The
  scroll request is consumed once, so later manual scrolling is left alone.
- Failed session reads show a connection error and Retry in the dashboard, login
  page, and popup. They no longer masquerade as a signed-out session.
- Escape in Search/Create returns to the command bar root; Escape at the root closes it.
- The desktop popup starts open without a mount-time dismiss race, resizes after
  session loading, and shows a useful sign-in state instead of an empty window.
- Selecting a task in the desktop popup returns the main window to the dashboard,
  including when it was showing Settings.
- The popup has no macOS traffic lights. Its empty top area drags the native
  window; the search field and scrollable results remain interactive.
