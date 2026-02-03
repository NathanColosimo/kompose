## State consolidation summary

- Added a shared state package at `packages/state` with Jotai atoms, shared hooks, and a `StateProvider` to centralize data/query logic between web and native.
- Implemented a storage adapter layer with `createPersistedAtom` and platform adapters (web localStorage, native SecureStore) so persisted atoms stay in sync.
- Wired both apps to the shared state package: web `Providers` now wraps `StateProvider`, native root layout now wraps it too.
- Migrated web and native imports to use shared atoms/hooks; removed legacy web atoms/hooks and added web-only replacements at `apps/web/src/state/sidebar.ts` and `apps/web/src/lib/use-mobile.ts`.
- Updated dependencies to include `@kompose/state` and adjusted TypeScript config/types for the new package; verified `@kompose/state` type-check passes.

## `packages/state` contents

- `atoms/command-bar.ts`: Command bar open state and focused task id atoms.
- `atoms/current-date.ts`: Calendar date, timezone, visible days, and event window atoms.
- `atoms/google-colors.ts`: Google color palette atoms with normalization helpers.
- `atoms/google-data.ts`: Google accounts/calendars atoms plus derived visible calendar ids.
- `atoms/visible-calendars.ts`: Visible calendar selection atoms and toggle helpers.
- `config.ts`: Shared config atom plus helpers for accessing `orpc` and auth client.
- `hooks/use-google-accounts.ts`: Query hook for linked Google accounts.
- `hooks/use-google-calendars.ts`: Query hook for calendars per account.
- `hooks/use-google-event-mutations.ts`: Create/update/delete Google event mutations with optimistic updates.
- `hooks/use-google-events.ts`: Query hook for events per calendar/time window.
- `hooks/use-move-google-event-mutation.ts`: Google event move mutation.
- `hooks/use-recurring-event-master.ts`: Recurring master query options and hook.
- `hooks/use-tasks.ts`: Shared task query + optimistic mutations.
- `hooks/use-task-sections.ts`: Shared task sections (Inbox + Today with Overdue/Unplanned/Done) using timezone-aware filters.
- `hooks/use-visible-calendars.ts`: Hook wrapper around visible calendars atom.
- `index.ts`: Public exports for shared atoms/hooks/types.
- `state-provider.tsx`: State hydrator/provider wiring and session gating.
- `storage.ts`: Storage adapter interface + persisted atom helper + web adapter.
- `temporal-utils.ts`: Shared Temporal helpers for date math.
- `types.ts`: Shared types for auth client and ORPC utils.
