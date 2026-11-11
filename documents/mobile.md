# Mobile app (Expo / React Native)

## Screens

`apps/native` has three tabs:

- **Tasks tab**
  - Inbox, Today, and tag-filtered task lists.
  - Create / edit / delete tasks.
  - Mark done / mark todo.
  - Uses the existing `tasks.*` oRPC endpoints.

- **Calendar tab**
  - 1–3 day time grid (toggle 1d/2d/3d).
  - Shows:
    - **Scheduled tasks** (tasks with `startDate` + `startTime`).
    - **Google Calendar timed events** (all-day events display in a small row).
  - Calendar visibility picker (per-account calendars, persisted).
  - Empty-slot tap offers `New event` or `New task`.
  - Create / edit / delete **Google Calendar** timed events.
  - Create scheduled tasks directly from the calendar tab.
  - Tap-to-edit scheduled tasks (basic edit/delete from calendar).

- **Settings tab**
  - Theme toggle (Light / Dark / System).
  - Sign in / Sign out functionality.
  - Account info display when signed in.

## Architecture

- **Expo SDK 58** with React Native 0.88.1 and the New Architecture.
- **Online-first**: no SQLite/offline sync yet; everything goes through `/api/rpc`.
- **Auth**: Better Auth Expo plugin + cookie header injection + client-side
  last-login-method tracking via Expo storage.
  - Native oRPC requests must manually attach the Better Auth cookie from
    SecureStore **and** use `credentials: "omit"` so iOS/native cookie
    handling does not interfere with session resolution on `/api/rpc`.
- **Date/time inputs**: BNA UI `DatePicker` (bottom-sheet based).
- **Styling**: Uniwind + Tailwind CSS v4 + BNA UI components.
- **Theming**: see [mobile-theme.md](./mobile-theme.md) for tokens, fonts, switching, and persistence.
- **Sizing scale**: Uniwind default `rem` base (16px), with no NativeWind compatibility polyfill.
- **Navigation**: NativeTabs from `expo-router/native-tabs` for native iOS/Android tab bar.

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

## Implementation

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
    (settings)/
      _layout.tsx          <- Stack (for headers)
      index.tsx            <- Settings screen
  +not-found.tsx
```

Key files:
- `apps/native/app/(tabs)/_layout.tsx` - NativeTabs with SF Symbol icons
- `apps/native/app/_layout.tsx` - Root layout with QueryClient, StateProvider, and Better Auth session gating

### NativeTabs implementation

Uses `expo-router/native-tabs` for platform-native tab bars:
- iOS: Native UITabBar with SF Symbols, liquid glass on iOS 26+
- Android: Material 3 bottom navigation

Tab labels/icons use `NativeTabs.Trigger.Label` and `NativeTabs.Trigger.Icon`.

Each tab is wrapped in a Stack for native headers. Header controls use `Stack.Screen` with `headerLeft`/`headerRight` options.

### Modal dismissal

A sheet or dialog close handler finishes its exit animation before notifying the parent. When visibility changes afterward, an already-transparent modal hides immediately instead of animating again. Parent-driven closes still animate normally. The chooser and all-day list open their next sheet from `onDismissed`.

### Tasks implementation

- Layout: `apps/native/app/(tabs)/(tasks)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(tasks)/index.tsx`
- Data hook: `packages/state/src/hooks/use-tasks.ts` (imported via `@kompose/state/hooks`)
- Editor flow (shared by the Tasks and Calendar tabs): `apps/native/hooks/use-task-editor-flow.ts`
  owns the draft, create/save/delete/toggle-done, and the recurring-task scope prompts,
  which render through `apps/native/components/tasks/task-scope-dialogs.tsx`.

### Google calendar visibility picker

- Shared persisted state:
  - `packages/state/src/atoms/visible-calendars.ts`
- Picker UI modal:
  - `apps/native/components/calendar/calendar-picker-modal.tsx`
- Google accounts / calendars / events hooks:
  - `packages/state/src/hooks/use-google-accounts.ts` (imported via `@kompose/state/hooks`)
  - `packages/state/src/atoms/google-data.ts` (calendars per account)
  - `packages/state/src/hooks/use-google-events.ts` (imported via `@kompose/state/hooks`)

### Calendar implementation

- Layout: `apps/native/app/(tabs)/(calendar)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(calendar)/index.tsx`
  - Includes time gutter, day columns, event/task blocks, and create/edit modals.
  - Pull-to-refresh waits for its own requests to settle and restores the scroll position. Background fetches do not control its spinner or scroll restoration.
  - Reads directly from the normal granular task/account/calendar/event caches.

### Settings + Theming

- Layout: `apps/native/app/(tabs)/(settings)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(settings)/index.tsx`
  - Theme toggle and auth UI
- Theme toggle component: `apps/native/components/mode-toggle.tsx`
- Color scheme hook (derived from the Uniwind theme, with SecureStore persistence):
  - `apps/native/lib/color-scheme-context.tsx`
- React Navigation theme tokens:
  - `apps/native/lib/theme.ts`

### Auth + RPC

- Better Auth client: `apps/native/lib/auth-client.ts`
  - Includes Expo `lastLoginMethodClient` for "Last used" auth UI hints.
- Session gating:
  - The root layout subscribes through `authClient.useSession()` and starts
    realtime sync with the authenticated user's ID.
- oRPC client (cookie injection + required server URL):
  - Uses `expo/fetch` for streaming and forces `credentials: "omit"` on
    authenticated requests because the session cookie is attached manually.
  - `apps/native/utils/orpc.ts`
  - Settings calls `clearAuthenticatedQueries` on sign-out to remove tasks,
    linked accounts, Google profiles, calendars, colors, and events.
- Google / Apple social sign-in buttons (shown by the root layout when signed out):
  - `apps/native/components/social-auth-buttons.tsx`

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

## Editor behavior

See [mobile-task-popover.md](./mobile-task-popover.md) and
[mobile-event-popover.md](./mobile-event-popover.md) for editor layouts,
creation flows, and recurrence scope prompts.

## Dependency baseline

Expo and React Native versions are listed above; exact Expo package versions
and the Uniwind version live in `apps/native/package.json`. Tailwind CSS uses
the root workspace catalog.

## Local troubleshooting

Restart Metro with `bun run dev:native` after route-resolution problems.
Use `bunx expo start --clear` from `apps/native` only when troubleshooting a
stale Metro cache; clearing it on every normal start makes startup slower.

If simulator Google OAuth fails while device sign-in works, keep the server
hostname consistent throughout the flow. For a corrupted simulator, erase only
the affected device in Xcode's Devices and Simulators window, then reinstall
with `bun run --cwd apps/native ios`.

## Environment variables

- `apps/native/.env`
  - `EXPO_PUBLIC_SERVER_URL=https://local.kompose.dev`
  - A physical device needs a URL that is resolvable and trusted from that
    device; the Mac-only Portless hostname is intended for the simulator.

## How to run

### 1) Start the Next.js server (serves `/api/rpc`)

Start the Portless proxy once with `bun run portless:proxy`, then from the repo root:

```bash
bun run dev:web
```

### 2) Start Metro for the native app

From repo root:

```bash
bun run dev:native
```

### 3) Build + run the dev client (iOS)

From repo root:

```bash
bun run --cwd apps/native ios
```

## Production releases

See [ci-cd.md](./ci-cd.md) for fingerprint-based OTA updates, native builds,
submission, and production environment configuration.
