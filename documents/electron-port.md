# Electron desktop

`apps/electron` is a thin shell around the hosted web app. Its windows load
`https://kompose.dev` (the dashboard and `/desktop/command-bar`), so the desktop
UI matches the web deploy. Chromium caches hashed Next.js chunks on disk
between launches; cache misses still fetch assets. If the
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

The popup stores desired visibility separately from its first-paint readiness.
Shortcut presses toggle that desired state, and every dismissal clears it, so
an open followed by another press or dismissal while loading stays hidden.

Task selections wait for the main renderer's task subscription, rather than
`did-finish-load`. The optional `setTaskListenerReady` handshake runs after the
listener is installed. Preload also signals subscription and final unsubscription
through the existing `onOpenTask` API, so older hosted web versions work with new
desktop installs. Main-frame navigation resets readiness, retaining the latest
pending selection through login, offline pages, and retries until the app
subscribes again. As before, a newer pending selection replaces an older one.

Downloaded updates remain main-process state. The optional `getReadyUpdate`
snapshot is queried after subscribing to `onUpdateReady`, recovering updates
downloaded before hydration or during offline navigation. Preload replays the
snapshot for older web versions too. A live event takes precedence over an older
snapshot response, and cleaned-up subscriptions ignore snapshot responses.
New web code feature-detects both optional methods; older installed desktops
keep their existing event-only behavior.

## Releases

Desktop releases are only needed for main-process or preload changes; UI changes
ship with the web deploy.

Releases ship as **Kompose** with the Tauri app's bundle ID
(`com.nathancolosimo.kompose`): installing the DMG replaces the Tauri app in
`/Applications`. Users sign in once, because the Electron profile is new.
Existing Tauri installs do not auto-update to Electron; they need the new DMG.
Builds are Apple Silicon (arm64) only.

See [ci-cd.md](./ci-cd.md) for release fingerprints, versioning, signing,
notarization, publishing, and retries.

Installed apps check for updates every 30 minutes via electron-updater and
download them in the background. The web app offers a restart; otherwise the
update installs on the next quit.

## Authentication

Google blocks OAuth inside embedded browsers, so sign-in runs in the system
browser through the Better Auth Electron plugin. The login page calls
`window.requestAuth`; the browser completes OAuth, and the browser-side
`electronProxyClient` returns a PKCE code through the
`com.nathancolosimo.kompose:` URL scheme. Main exchanges it at `/electron/token`,
copies the returned session cookies into the windows' cookie store, and reloads
the main window. From then on the windows are ordinary same-origin web pages:
sessions refresh and sign out exactly as on the web.

The web `DesktopAuth` component owns browser handoff. A complete Electron PKCE
query on `/login` transfers an already signed-in browser session; signed-out
browsers keep the normal sign-in form. After OAuth, the plugin's authorization
cookie signals the handoff even though `/dashboard` has no Electron query.
Ordinary browser visits start no polling.

Handoff moves through idle, transferring, waiting for a code, complete, or an
error with a retry button. Polling starts only for an authorization cookie or
a successful transfer, checks every 100 ms, and fails after 10 seconds without
a code. Unmounting or replacing the handoff aborts the request and clears its
poller, including retries; late responses cannot start another poller.

Implementation follows the installed `@better-auth/electron` 1.7.14:
`dist/proxy.mjs:18–53` exposes `getAuthorizationCode()` and implements
`ensureElectronRedirect()` with an interval but no completion callback.
Kompose uses the accessor with its own cancellable poller to expose completion
and timeout, preserving the plugin's cookie deletion and
`<scheme>://auth/callback#token=<cookie value>` redirect. The callback gets the
opaque cookie value, not the identifier returned by `transferUser`.
`dist/index.mjs:144–180,195–224,235–271` implements transfer and OAuth hooks
that set this readable cookie. Complete means the browser dispatched the app
URL; the browser cannot confirm that the OS opened the app.

Account linking opens the normal settings page in the browser and uses Better
Auth's standard `linkSocial`, including WHOOP's generic provider. Use the same
Kompose account in that browser; linked accounts refresh when the app regains
focus.

## Process boundaries

Windows use context isolation, sandboxing, and no Node integration. Bridge calls
are accepted only from the app origin's main frame. Navigation to other origins,
and every new window, opens in the system browser instead. Permission requests
are denied.

See [command-bar.md](./command-bar.md#desktop-global-shortcut-electron) for popup lifecycle, shortcuts, and focus behavior.

The main window reopens where it was last closed, and the popup reopens where it
was last dragged when that spot is on the display under the cursor. Both are
clamped into the display's work area. The popup's height follows its content;
growth near the bottom edge shifts it up until it shrinks again.
