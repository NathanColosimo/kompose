# Mobile app (Expo / React Native) status

## What we built (MVP)

We implemented the initial mobile MVP inside `apps/native` with **three tabs**:

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

- **Settings tab**
  - Theme toggle (Light / Dark / System).
  - Sign in / Sign out functionality.
  - Account info display when signed in.

## Key architecture decisions (current)

- **Expo SDK 54 (stable)**.
- **Online-first**: no SQLite/offline sync yet; everything goes through `/api/rpc`.
- **Auth**: Better Auth Expo plugin + cookie header injection.
- **Date/time inputs**: BNA UI `DatePicker` (bottom-sheet based).
- **Styling**: NativeWind (Tailwind for React Native) + BNA UI components.
- **Theming**: CSS variables via NativeWind's `vars()` function for dynamic light/dark mode switching.
- **Navigation**: NativeTabs from `expo-router/unstable-native-tabs` for native iOS/Android tab bar.

## UI components

**Always check [BNA UI](https://ui.ahmedbna.com/docs/components) before hand-rolling UI components.**

The project uses BNA UI as its component library for NativeWind-styled primitives and higher-level components.

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

### Settings + Theming

- Layout: `apps/native/app/(tabs)/(settings)/_layout.tsx`
- Screen: `apps/native/app/(tabs)/(settings)/index.tsx`
  - Theme toggle and auth UI
- Theme toggle component: `apps/native/components/mode-toggle.tsx`
- Color scheme context (shared state for theme switching):
  - `apps/native/lib/color-scheme-context.tsx`
- NativeWind theme variables (dynamic CSS vars):
  - `apps/native/lib/theme-vars.ts`
- React Navigation theme tokens:
  - `apps/native/lib/theme.ts`

### Auth + RPC

- Better Auth client: `apps/native/lib/auth-client.ts`
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

NativeWind uses CSS variables for theming. To dynamically switch themes at runtime:

1. **ColorSchemeProvider** (`lib/color-scheme-context.tsx`)
   - Wraps the entire app at the root level
   - Stores user preference in SecureStore (light/dark/system)
   - Provides `useColorScheme()` hook for all components to access shared theme state

2. **Theme variables** (`lib/theme-vars.ts`)
   - Uses NativeWind's `vars()` function to define CSS variable values for light and dark modes
   - Applied via `style` prop on a root View wrapper

3. **Root layout** (`app/_layout.tsx`)
   - Applies theme vars: `style={isDarkColorScheme ? themeVars.dark : themeVars.light}`
   - Also applies `dark` class for Tailwind's dark mode utilities
   - Provides React Navigation theme via ThemeProvider

4. **CSS variables** (`global.css`)
   - Defines default variable values in `:root` and `.dark` selectors
   - Used by Tailwind config to map semantic colors (e.g., `bg-background`)

### Adding new theme colors

1. Add the CSS variable to both `:root` and `.dark` in `global.css`
2. Add the variable to both `light` and `dark` objects in `lib/theme-vars.ts`
3. Add the Tailwind color mapping in `tailwind.config.ts`

## Expo SDK 54 baseline

Current versions in `apps/native/package.json`:
- `expo@~54.0.33`
- `react-native@0.81.5`
- SDK54-pinned Expo packages (`expo-constants`, `expo-linking`, etc.).

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

## Notes / limitations (v1)

- Recurrence scope is treated as `"this"` on mobile for now.
- No offline-first/local DB yet (online-first only).
