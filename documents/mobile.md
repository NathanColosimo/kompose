# Mobile app (Expo / React Native) status

## What we built (MVP)

We implemented the initial mobile MVP inside `apps/native` with **four tabs**:

- **Tasks tab**
  - Inbox-style list (non-done, non-scheduled tasks).
  - Create / edit / delete tasks.
  - Mark done / mark todo.
  - Uses the existing `tasks.*` oRPC endpoints.

- **Calendar tab**
  - 1–3 day time grid (toggle 1d/2d/3d).
  - Shows:
    - **Scheduled tasks** (tasks with `startDate` + `startTime`).
    - **Google Calendar timed events** (all-day events display in a small row).
  - Calendar visibility picker (per-account calendars, persisted).
  - Create / edit / delete **Google Calendar** timed events.
  - Tap-to-edit scheduled tasks (basic edit/delete from calendar).

- **Chat tab**
  - AI chat with streaming responses.
  - Session management (create, switch sessions via header popover).
  - Model selection (GPT-5, GPT-5 Mini).
  - Chain-of-thought reasoning display.
  - Tool calling with approval flow (approve/reject server-side actions).
  - Image attachments.

- **Settings tab**
  - Theme toggle (Light / Dark / System).
  - Sign in / Sign out functionality.
  - Account info display when signed in.

## Key architecture decisions (current)

- **Expo SDK 55 (preview)** with React Native 0.83.x.
- **New Architecture always on** in SDK 55 (no legacy toggle).
- **Online-first**: no SQLite/offline sync yet; everything goes through `/api/rpc`.
- **Auth**: Better Auth Expo plugin + cookie header injection + client-side
  last-login-method tracking via Expo storage.
- **Date/time inputs**: BNA UI `DatePicker` (bottom-sheet based).
- **Styling**: Uniwind + Tailwind CSS v4 + BNA UI components.
- **Theming**: Uniwind CSS theme variables in `global.css` + runtime `Uniwind.setTheme()` for light/dark/system switching.
- **Sizing scale**: Uniwind default `rem` base (16px), with no NativeWind compatibility polyfill.
- **Navigation**: NativeTabs from `expo-router/unstable-native-tabs` for native iOS/Android tab bar.

## UI components

**Always check [BNA UI](https://ui.ahmedbna.com/docs/components) before hand-rolling UI components.**

The project uses BNA UI as its component library for utility-class-styled primitives and higher-level components.

### Adding a new component

1. Check if the component exists at https://ui.ahmedbna.com/docs/components
2. If available, add it via CLI:
   ```bash
   bunx bna-ui add <component-name> --bun -y
   ```
3. Adjust generated component APIs to match app conventions (`Icon as={...}`, shared `Text` variants, theme hooks).

### Existing UI components

Components live in `apps/native/components/ui/`:
- `button.tsx` - Primary button + icon/loading variants
- `checkbox.tsx` - Styled checkbox control
- `input.tsx` / `textarea.tsx` - Text and multiline inputs
- `text.tsx` / `icon.tsx` / `view.tsx` - Shared primitives
- `date-picker.tsx` - Date/time picker for all scheduling flows
- `bottom-sheet.tsx`, `tabs.tsx`, `switch.tsx`, `alert-dialog.tsx` - Core app interaction patterns

## Major changes + where

### App structure / navigation

Uses **NativeTabs** for native iOS/Android tab bar experience:

```
app/
  _layout.tsx              <- Root layout with Stack + providers
  (tabs)/
    _layout.tsx            <- NativeTabs with SF Symbols
    (tasks)/
      _layout.tsx          <- Stack (for headers)
      index.tsx            <- Tasks screen
    (calendar)/
      _layout.tsx          <- Stack (for headers)
      index.tsx            <- Calendar screen
    (chat)/
      _layout.tsx          <- Stack (for headers)
      index.tsx            <- Chat screen
    (settings)/
      _layout.tsx          <- Stack (for headers)
      index.tsx            <- Settings screen
  modal.tsx
  +not-found.tsx
```

Key files:
- `apps/native/app/(tabs)/_layout.tsx` - NativeTabs with SF Symbol icons
- `apps/native/app/_layout.tsx` - Root layout with QueryClient, StateProvider, auth

### NativeTabs implementation

Uses `expo-router/unstable-native-tabs` for platform-native tab bars:
- iOS: Native UITabBar with SF Symbols, liquid glass on iOS 26+
- Android: Material 3 bottom navigation

On SDK 55, tab labels/icons should use `NativeTabs.Trigger.Label` and `NativeTabs.Trigger.Icon`.

Each tab is wrapped in a Stack for native headers. Header controls use `Stack.Screen` with `headerLeft`/`headerRight` options.

### Tasks implementation

- Layout: `apps/native/app/(tabs)/(tasks)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(tasks)/index.tsx`
- Data hook: `packages/state/src/hooks/use-tasks.ts` (imported via `@kompose/state/hooks`)

### Google calendar visibility picker

- Storage + helpers (SecureStore):
  - `apps/native/lib/visible-calendars.ts`
- Hook:
  - `apps/native/hooks/use-visible-calendars.ts`
- Picker UI modal:
  - `apps/native/components/calendar/calendar-picker-modal.tsx`
- Google accounts / calendars / events hooks:
  - `packages/state/src/hooks/use-google-accounts.ts` (imported via `@kompose/state/hooks`)
  - `packages/state/src/hooks/use-google-calendars.ts` (imported via `@kompose/state/hooks`)
  - `packages/state/src/hooks/use-google-events.ts` (imported via `@kompose/state/hooks`)

### Calendar implementation

- Layout: `apps/native/app/(tabs)/(calendar)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(calendar)/index.tsx`
  - Includes time gutter, day columns, event/task blocks, and create/edit modals.

### Chat implementation

- Layout: `apps/native/app/(tabs)/(chat)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(chat)/index.tsx`
  - Uses `useChat` from `@ai-sdk/react` with custom `ChatTransport` via oRPC.
  - `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
    ensures tool approvals trigger server-side execution.
  - Segment-based message rendering (`buildMessageSegments`) correctly interleaves
    reasoning, text, and tool parts.
  - Data hook: `packages/state/src/hooks/use-ai-chat.ts` (imported via `@kompose/state/hooks`)
- AI chat components live in `apps/native/components/ai-chat/`:
  - `message.tsx` — Message, MessageContent, MessageResponse
  - `chain-of-thought.tsx` — Collapsible reasoning display
  - `tool.tsx` — Collapsible tool invocation (header, input, output)
  - `confirmation.tsx` — Approval flow (request, accepted, rejected states)
  - `prompt-input.tsx` — Composer with image attachments
  - `attachments.tsx` — File attachment display
  - `conversation.tsx` — Conversation container with scroll button
  - `model-selector.tsx` — Model selection UI
  - `context.tsx` — Context provider

### Settings + Theming

- Layout: `apps/native/app/(tabs)/(settings)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(settings)/index.tsx`
  - Theme toggle and auth UI
- Theme toggle component: `apps/native/components/mode-toggle.tsx`
- Color scheme hook (shared state for theme switching + persistence):
  - `apps/native/lib/color-scheme-context.tsx`
- React Navigation theme tokens:
  - `apps/native/lib/theme.ts`

### Auth + RPC

- Better Auth client: `apps/native/lib/auth-client.ts`
  - Includes Expo `lastLoginMethodClient` for "Last used" auth UI hints.
- oRPC client (cookie injection + URL fallback):
  - `apps/native/utils/orpc.ts`
- Added Google social sign-in buttons:
  - `apps/native/components/sign-in.tsx`
  - `apps/native/components/sign-up.tsx`

## Safe area handling

**Do NOT use SafeAreaView.** Instead:

1. **For screens inside a Stack**: Use `ScrollView` or `FlatList` with `contentInsetAdjustmentBehavior="automatic"` - this automatically adjusts for headers, tab bars, and device notches.

2. **For header controls**: Use `Stack.Screen` with `headerLeft`/`headerRight` options instead of custom header Views.

Example:
```tsx
<FlatList
  contentInsetAdjustmentBehavior="automatic"
  contentContainerStyle={{ paddingHorizontal: 16 }}
  ...
/>
```

## Theming architecture

### How dark mode works

Uniwind uses theme variants and CSS variables defined in `global.css`. To dynamically switch themes at runtime:

1. **Color scheme hook** (`lib/color-scheme-context.tsx`)
   - Hook-level state with SecureStore persistence
   - Stores user preference in SecureStore (light/dark/system)
   - Calls `Uniwind.setTheme()` to apply theme at runtime

2. **Theme variables** (`global.css`)
   - Uses `@layer theme` with `@variant light` and `@variant dark`
   - Exposes semantic tokens like `--color-background`, `--color-foreground`, etc.

3. **Root layout** (`app/_layout.tsx`)
   - Imports `global.css` once at the app root
   - Reads effective scheme from `useColorScheme()`
   - Provides React Navigation theme via ThemeProvider

### Adding new theme colors

1. Add the color variable to both `@variant light` and `@variant dark` in `global.css`
2. Keep variable names consistent across themes (same keys in both variants)
3. Use semantic classes in components (for example, `bg-background`, `text-foreground`)

## Expo SDK 55 baseline

Current versions in `apps/native/package.json`:
- `expo@55.0.0-preview.10`
- `react-native@0.83.1`
- SDK55-pinned Expo packages (`expo-constants`, `expo-linking`, etc.).
- `tailwindcss@^4`
- `uniwind@^1.3.0`

## Build + bundling issues we hit (and fixes)

### 1) iOS build failed: Node pinned to Homebrew Cellar path

Error was basically: Node path not found during a CocoaPods script phase.

Fix:
- Updated `apps/native/ios/.xcode.env.local` to use the stable shim:
  - `export NODE_BINARY=/opt/homebrew/bin/node`

Note:
- `expo prebuild --clean` regenerated `.xcode.env.local` again later, so we re-applied the stable path.

### 2) Metro bundling failed (old router path)

We confirmed runtime resolution was correct, and the fix was to fully restart Metro:
- stop the running Expo CLI (Ctrl+C)
- restart with `bun run dev` (clears cache)

### 3) Metro bundling failed: missing `expo-network`

`@better-auth/expo` dynamically imports `expo-network`.

Fix:
- Installed `expo-network` into `apps/native`.

### 4) iOS simulator Google OAuth "Something went wrong" (local only)

Symptoms:
- Google sign-in works in TestFlight/real device but fails in iOS Simulator with a Google "Something went wrong" / unknown error page.
- Server logs show auth start/proxy requests, but local simulator flow can still fail unexpectedly.

Most reliable local reset:
- Run `bun run ios:reset-simulator` from `apps/native`.
- This shuts down + erases all simulators, clears Xcode DerivedData, then reinstalls the iOS dev client.

Notes:
- Keep host usage consistent during a test run (`localhost` only, or ngrok only).
- This issue appears simulator-state related; production/TestFlight auth can remain healthy.

### 5) iOS pod warning: deployment target set to 9.0

Symptom:
- Xcode warning from pod targets (for example `SDWebImage`) saying `IPHONEOS_DEPLOYMENT_TARGET` is `9.0`.

Fix:
- Added a custom Expo config plugin at `apps/native/plugins/with-ios-pod-deployment-target.js`.
- Wired it in `apps/native/app.json` plugins list.
- The plugin injects a `post_install` step into Podfile generation to align all pod targets with the app deployment target.

Why this matters:
- `expo prebuild --clean` can regenerate `ios/Podfile`. The plugin ensures this fix is re-applied on every prebuild, not just once manually.

## Environment variables

- `apps/native/.env`
  - `EXPO_PUBLIC_SERVER_URL=http://localhost:3001`
  - For a physical device, this must be your LAN IP (not localhost).

## How to run (current recommended workflow)

### 1) Start the Next.js server (serves `/api/rpc`)

From repo root:

```bash
bun run dev
```

### 2) Start Metro for the native app

From `apps/native`:

```bash
bun run dev
```

### 3) Build + run the dev client (iOS)

From `apps/native`:

```bash
bun run ios
```

## Production release flow (iOS)

Native production scripts are:

- `bun run --cwd apps/native build:prod`
  - Creates `apps/native/dist/kompose.ipa` using the EAS `production`
    profile with `--local` (builds on your machine, not EAS cloud).
  - Runs with `--non-interactive` so EAS does not prompt in terminal
    automation.
  - Sets `EAS_LOCAL_BUILD_SKIP_CLEANUP=1` and
    `EAS_LOCAL_BUILD_WORKINGDIR=~/.eas-build-cache/native` to persist the
    build working directory between runs. This allows `pod install` to
    reuse previously downloaded pods instead of fetching from scratch.
- `bun run --cwd apps/native submit:prod`
  - Submits the existing IPA to App Store Connect and waits for status.
  - Runs with `--non-interactive` to avoid interactive prompts.

Root orchestration uses Turborepo with per-platform shortcuts:

- `bun run build:prod` — builds everything (type-check → desktop →
  web + native).
- `bun run build:prod:native` — builds only native (type-check native
  deps → native IPA).
- `bun run submit:prod:native` — submits just the native IPA.
- `bun run build:prod:web` / `bun run submit:prod:web` — web-only
  equivalents (Vercel deploy + desktop release).
- `bun run submit:prod:desktop` — desktop GitHub release only.
- `submit:prod` has `cache: false` (deployment side-effect; always
  re-runs).
- `submit:prod:desktop` has `cache: true` with
  `dependsOn: ["build:prod:desktop"]` — skipped when no client-side
  changes occurred since the last release.
- **Important**: Always run from repo root. Running `bun run build:prod`
  directly inside `apps/native/` bypasses Turbo (no caching).

### Turbo caching for production tasks

Production task configuration uses **Package Configurations**
(`apps/web/turbo.json` and `apps/native/turbo.json` with
`"extends": ["//"]`) instead of `package#task` overrides in the root
`turbo.json`.

- `native#build:prod`: caches `dist/**` (the IPA). Includes
  `dependsOn: ["^build"]` so the cache key factors in workspace
  dependency changes (e.g. `@kompose/state`).
- `web#build:prod:desktop`: caches the Tauri bundle at
  `src-tauri/target/aarch64-apple-darwin/release/bundle/**`.
- `web#build:prod`: caches `.next/**` (excluding `.next/cache/**`).
- `web#submit:prod:desktop`: cached turbo task that depends on
  `build:prod:desktop`. If no source files changed since the last
  successful release, the task is a cache hit and skipped entirely.
  The release script (`release-dmg.sh`) is also idempotent — it
  gracefully skips if the GitHub release tag already exists.

### Why local iOS builds are slow

`eas build --local` always creates a fresh temp directory, runs
`expo prebuild` (regenerates `ios/`), runs `pod install`, and does a full
`xcodebuild` compilation. Local builds do not support EAS's cloud caching
features (pod cache, compiler ccache). The persistent working directory
env vars mitigate this by keeping downloaded pods across runs, but
prebuild still regenerates `ios/` each time.

## Notes / limitations (v1)

- Recurrence scope is treated as `"this"` on mobile for now.
- No offline-first/local DB yet (online-first only).
