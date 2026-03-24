## State consolidation summary

- Added a shared state package at `packages/state` with Jotai atoms, shared hooks, and a `StateProvider` to centralize data/query logic between web and native.
- Implemented a storage adapter layer with `createPersistedAtom` and platform adapters (web localStorage, native SecureStore) so persisted atoms stay in sync.
- Wired both apps to the shared state package: web `Providers` now wraps `StateProvider`, native root layout now wraps it too.
- Session ownership is now centralized in the shared state layer. Web dashboard and native root layout both gate off the shared session query instead of issuing separate first-load `getSession()` reads.
- Migrated web and native imports to use shared atoms/hooks; removed legacy web atoms/hooks and added web-only replacements at `apps/web/src/state/sidebar.ts` and `apps/web/src/lib/use-mobile.ts`.
- Added a shared AI chat hook at `packages/state/src/hooks/use-ai-chat.ts` that uses oRPC chat procedures (`orpc.ai.*`) for sessions, messages, and stream/reconnect helpers.
- The dashboard and native calendar now rely directly on the normal granular TanStack Query hooks instead of a separate bootstrap prefetch path.
- Updated dependencies to include `@kompose/state` and adjusted TypeScript config/types for the new package; verified `@kompose/state` type-check passes.

## `packages/state` contents

- `collision-utils.ts`: Shared collision detection for calendar events (web + native). Calculates column positions, column spans, and z-index for overlapping items. Uses a 30-min side-by-side threshold, max 3 columns, and threshold-aware span expansion so events use full width when adjacent columns are stackable.
- `atoms/command-bar.ts`: Command bar open state and focused task id atoms.
- `atoms/auth.ts`: Auth convenience atoms, including synchronous
  `lastUsedLoginMethodAtom` sourced from the configured auth client.
- `atoms/current-date.ts`: Calendar date, timezone, visible days, event window atoms, and reactive `todayPlainDateAtom` / `nowZonedDateTimeAtom` (refreshed every 60s and on window focus/visibility via `todayTickAtom`).
- `atoms/google-colors.ts`: Google color palette atoms with normalization helpers.
- `account-query-keys.ts`: Shared query keys for linked Better Auth account discovery.
- `atoms/google-data.ts`: Shared linked Better Auth account query, Google-account derivations, per-account calendars, and derived visible calendar ids. The effective visible set is calculated during reads: if no explicit preference is saved yet, all currently loaded calendars are treated as visible; explicit saved selections are filtered against known linked accounts/calendars at runtime. When stale account ids are pruned during derivation, a microtask writes the cleaned selection back to persisted storage so every platform converges.
- `atoms/visible-calendars.ts`: Visible calendar selection atoms, a persisted-storage hydration flag, and toggle helpers. Missing persisted state remains `null` as "no explicit preference yet".
- `atoms/whoop-data.ts`: WHOOP account derivation from the shared linked-account query, month-anchored day summaries query atom with ±7 day padding and `keepPreviousData`, and derived `whoopSummariesByDayAtom` map. Components read directly via `useAtomValue` — no prop drilling needed.
- `ai-message-utils.ts`: Pure utility functions and types for AI SDK messages shared between web and native. Exports `isRecord`, `asString`, `formatToolName`, `normalizeMessageRole`, `toUiMessage`, `extractText`, `buildMessageSegments`, `extractAttachments`, and types `ToolPart`, `AttachmentData`, `MessageSegment`.
- `config.ts`: Shared config atom plus helpers for accessing `orpc` and auth client.
- `hooks/use-google-accounts.ts`: Query hook for Google-linked Better Auth `Account` records derived from the shared linked-account query.
- `hooks/use-google-calendars.ts`: Query hook for calendars per account.
- `hooks/use-google-event-mutations.ts`: Create/update/delete Google event mutations with optimistic updates.
- `hooks/use-google-events.ts`: Query hook for events per calendar and bounded time window.
- `hooks/use-google-account-profiles.ts`: Shared profile hook for linked Google accounts using Better Auth `OAuth2UserInfo`. It can fetch eagerly, but only surfaces that actually render linked-account metadata should depend on it for display.
- `hooks/use-move-google-event-mutation.ts`: Google event move mutation.
- `hooks/use-recurring-event-master.ts`: Recurring master query options and hook.
- `hooks/use-ai-chat.ts`: Shared AI chat sessions/messages queries, session mutations, and streaming/reconnect wrappers over `orpc.ai`.
- `hooks/use-realtime-sync.ts`: Shared SSE sync hook. Initial connects now stay quiet; broad task/calendar/chat invalidation only happens after an explicit `reconnect` event.
- `hooks/use-tasks.ts`: Shared task query + optimistic mutations.
- `hooks/use-today-tick.ts`: Keeps `todayPlainDateAtom` and `nowZonedDateTimeAtom` fresh by incrementing `todayTickAtom` every 60 seconds and on window focus/visibility change. Mounted in `StateProvider`.
- `hooks/use-task-sections.ts`: Shared task sections (Inbox + Today with Overdue/Unplanned/Done) using reactive today/now atoms for correct overdue detection across midnight boundaries.
- `hooks/use-visible-calendars.ts`: Hook wrapper around visible calendars atom.
- `whoop-query-keys.ts`: Shared query keys for WHOOP day summaries.
- `state-provider.tsx`: State hydrator/provider wiring, session gating, and today-tick refresh lifecycle.
- `storage.ts`: Storage adapter interface, persisted atom helper, and web adapter.
- `temporal-utils.ts`: Shared Temporal helpers for date math.
- `types.ts`: Shared types for auth client and ORPC utils (no REST chat client interface).
