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
For local HTTPS, launch the executable with
`NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem"` so Electron's Node requests trust
the already-installed development CA as well as Chromium.

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
stream without buffering. The upstream RPC request uses Node fetch in main so
Chromium does not issue a renderer CORS preflight or drop the plugin cookie.
Static assets use a registered secure app protocol.
Windows use context isolation, sandboxing, no Node integration, restricted IPC,
and external navigation through the system browser.

The command popup is created on first use and released after 60 seconds hidden.
It is available from the global shortcut and File → Open Command Bar.
The existing main-process settings store remembers both windows' bounds and the
main window's maximized state. Bounds are saved after movement/resizing and
flushed on hide/close. Restoring clamps them to an available display's work area.
The popup retains its position while its height continues to follow its content;
expansion near a screen edge keeps the entire popup reachable.
App-specific IPC covers the window/shortcut/update operations and query refresh
notifications. The dashboard renderer is shared with the web app.

## Validation

Boundary tests cover asset traversal, trusted origins, external URL schemes,
session redaction, and response header filtering. Run `bun run type-check`,
`cd apps/electron && bun run test`, and `bun run build:desktop`.
A packaged browser sign-in round trip was verified against the local server.
Account linking and signed update installation still need separate end-to-end
verification; a renderer build alone does not verify them.

References: [Better Auth Electron](https://better-auth.com/docs/integrations/electron),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

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

## Authenticated local QA (2026-10-08)

Computer Use inspected the installed Tauri dashboard, Settings, and in-window
command palette, then exercised the unsigned Electron package. Chrome was used
for local web development and browser OAuth. OrbStack Postgres and Redis and the
trusted `https://local.kompose.dev` proxy served the local API. Google sign-in used
the requested account's existing permissions and the official Electron deep-link
and token exchange. The session survived application restarts.

Verified in Electron: nine real Google calendars and their events, Settings with
the account identity, task creation/editing/scheduling/completion, task search,
and the current-time line aligned with the time gutter. Task updates appeared in
Chrome without reloading. Calendar visibility choices survived a Chrome reload.
The local QA task was left completed; production tasks and events were not edited.
During a second pass, dragging that task in Chrome moved it from 6:00 to 6:30 PM,
and resizing extended it to 7:30 PM. Both changes survived a reload and appeared
in Electron on focus.

The native popup was checked for search, Create navigation, nested/root Escape,
opening a task while the main window was on Settings, absence of traffic lights,
and dragging the empty top strip while preserving text input. Batch native popup
actions in one focused Computer Use sequence: switching back to another app
between actions correctly dismisses this blur-to-close panel.

The second pass verified the dashboard at 720×640 in light and dark themes,
empty/no-match command searches, empty Create input, and nested/root Escape.
Stopping the local API reproduced a misleading sign-in prompt; the updated
packaged app instead kept the dashboard URL and showed Retry in both windows.
After restarting the API, Retry restored the existing account and calendars
without another sign-in. With six days visible, both ArrowRight and Next period
advanced from October 8 to October 14; ArrowLeft returned to October 8.

Current automated validation covers 16 boundary/regression tests (58 assertions),
all 11 workspace type checks, targeted Biome checks on changed source files, the
static desktop build, and unsigned macOS packaging. The iOS export and web
production build also passed during the initial port review. The second-pass
fixes were rebuilt, packaged, and checked in the native Electron app.

The window/Today follow-up was also rebuilt and packaged. Computer Use verified
Today from an already-selected date, `T` after navigating to another period,
maximized-state restoration across quit/relaunch, and return to the prior normal
size. Moving the main window between displays updated its saved position. A
non-default settings fixture restored a 1100×700 main window at (200,120) and a
480×198 popup at (300,150); the popup retained those bounds after opening and
hiding instead of recentering. Native drag automation did not move the windows
reliably in this pass, so drag-specific persistence is not counted separately.
Bounds tests cover disconnected displays, negative monitor coordinates, invalid
saved bounds, and popup expansion near a work-area edge.

Remaining checks: signed/notarized distribution and update installation, linking
another Google/WHOOP account, signed-out popup interaction, and native calendar
drag/resize persistence. A native Computer Use drag showed a preview but did not
persist; Chrome drag/resize passed, so native input remains inconclusive rather
than a confirmed app defect. The installed Tauri global popup was not
captured, so its comparison is limited to the in-window palette. A cold Bun/Next
dev start after deleting `.next` also produced a transient `pg-types` resolution
error; restarting after Next generated its external-package symlinks restored
HTTP 200 and authenticated RPCs. The development command remains on Bun because
the Redis adapter depends on it. Later Chrome requests to the local domain reached
a Vercel 404 while the local proxy and native app still worked; final native QA
continued, but that Chrome routing discrepancy remains unresolved.
