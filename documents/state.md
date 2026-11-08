## State consolidation summary

- Added a shared state package at `packages/state` with Jotai atoms, shared hooks, and a `StateProvider` to centralize data/query logic between web and native.
- Implemented a storage adapter layer with `createPersistedAtom` and platform adapters (web localStorage, native SecureStore) so persisted atoms stay in sync.
- Wired both apps to the shared state package: web `Providers` now wraps `StateProvider`, native root layout now wraps it too.
- Session ownership is now centralized in the shared state layer. Web dashboard and native root layout both gate off the shared session query instead of issuing separate first-load `getSession()` reads.
- While the web dashboard waits for the session check, `DashboardQueries` (`apps/web/src/components/dashboard-queries.tsx`) subscribes to its first queries (tasks, tags, linked accounts, calendars, events, WHOOP), so they run alongside the check; nothing is stored on the device. A signed-out visitor's requests fail as oRPC `UNAUTHORIZED` or a Better Auth 401 (the apps call `listAccounts` with `throw: true`, so it throws an error with `status`). The web query client neither retries nor toasts these, and the layout redirects to `/login`. The same errors with a session loaded mean the session ended, so the query client refetches it and the layout redirects.
- Migrated web and native imports to use shared atoms/hooks; removed legacy web atoms/hooks and added web-only replacements at `apps/web/src/state/sidebar.ts` and `apps/web/src/lib/use-mobile.ts`.
- The dashboard and native calendar now rely directly on the normal granular TanStack Query hooks instead of a separate bootstrap prefetch path.
- Updated dependencies to include `@kompose/state` and adjusted TypeScript config/types for the new package; verified `@kompose/state` type-check passes.

## `packages/state` contents

- `collision-utils.ts`: Shared layout for overlapping calendar items (web + native). Items that start within 30 minutes of a group's first one sit side by side in it; a later one stacks on top, indented one level, so a long block keeps its width and its title shows. Nothing is covered before 15 minutes of it shows.
- `atoms/command-bar.ts`: Command bar open state and focused task id atoms.
- `atoms/auth.ts`: Auth convenience atoms, including synchronous
  `lastUsedLoginMethodAtom` sourced from the configured auth client.
- `atoms/current-date.ts`: Calendar date, timezone, visible days, event window atoms, and reactive `todayPlainDateAtom` / `nowZonedDateTimeAtom` (refreshed every 60s and on window focus/visibility via `todayTickAtom`).
- `atoms/google-colors.ts`: Google color palette atoms with normalization helpers.
- `account-query-keys.ts`: Shared query keys for linked Better Auth account discovery.
- `atoms/google-data.ts`: Shared linked Better Auth account query, Google-account derivations, per-account calendars, and derived visible calendar ids. The effective visible set is calculated during reads: if no explicit preference is saved yet, all currently loaded calendars are treated as visible; explicit saved selections are filtered against known linked accounts/calendars at runtime. When stale account ids are pruned during derivation, a microtask writes the cleaned selection back to persisted storage so every platform converges.
- `atoms/visible-calendars.ts`: Visible calendar selection atoms, a persisted-storage hydration flag, and toggle helpers. Missing persisted state remains `null` as "no explicit preference yet".
- `atoms/whoop-data.ts`: WHOOP account derivation from the shared linked-account query, month-anchored day summaries query atom with ±7 day padding and `keepPreviousData`, and derived `whoopSummariesByDayAtom` map. Components read directly via `useAtomValue` — no prop drilling needed.
- `config.ts`: Shared config atom plus helpers for accessing `orpc` and auth client.
- `hooks/use-google-accounts.ts`: Query hook for Google-linked Better Auth `Account` records derived from the shared linked-account query.
- `hooks/use-google-event-mutations.ts`: Create/update/delete Google event mutations with optimistic updates.
- `hooks/use-google-events.ts`: Query hook for events, one query per calendar and month window (`eventWindowsAtom`: each month the visible days ±7 touch, so the page after the visible one is already loaded). Events crossing a month boundary come back in both months and are deduped by ID.
- `hooks/use-google-account-profiles.ts`: Shared profile hook for linked Google accounts using Better Auth `OAuth2UserInfo`. It can fetch eagerly, but only surfaces that actually render linked-account metadata should depend on it for display.
- `hooks/use-move-google-event-mutation.ts`: Google event move mutation (`moveGoogleEventMutationOptions`). An editor holding the save passes `HeldSave` (`quiet`, `failureMessage`), reported through `reportHeldSaveFailure` as for updates.
- `hooks/use-recurring-event-master.ts`: Recurring master query hook. Its failure shows beside Repeat (`meta.quietError`, typed in `state-provider.tsx`), not as a toast.
- `hooks/use-realtime-sync.ts`: Shared SSE sync hook. Initial connects now stay quiet; broad task/calendar invalidation only happens after an explicit `reconnect` event.
- `hooks/use-tasks.ts`: Shared task query + optimistic mutations.
- `hooks/use-today-tick.ts`: Keeps `todayPlainDateAtom` and `nowZonedDateTimeAtom` fresh by incrementing `todayTickAtom` every 60 seconds and on window focus/visibility change. Mounted in `StateProvider`.
- `hooks/use-task-sections.ts`: Shared task sections (Inbox + Today with Overdue/Unplanned/Done) using reactive today/now atoms for correct overdue detection across midnight boundaries.
- `google-event-recurrence.ts`: The repeat rule model the editors share (parse, build, follow a moved start) and the checks behind the scope dialog, modelled on what Google does, checked against its API: a rule meets once a day at the series' start time (a BYHOUR list is ignored; two times a day are two rules), and Google keeps an occurrence changed on its own (moved, renamed...) only at its original slot: a new start for the series (its time, or its day) cancels every one, a new repeat each whose slot it loses, and a new length alone gives each the series' length. The server refuses such saves, with typed reasons. `repeatSkipsOccurrence` says when Entire series would cancel the edited occurrence, and `entireSeriesCost` what it would cost a changed one (it replaces `movedMeetingDropped`); `entireSeriesStartMoves` tells a new start from a new length, and `entireSeriesMovesSeveralADay` a new time of day the server refuses for a series meeting several times a day. A series counts its days in its own zone (`seriesTimeZone`: its master's, else its original slot's), not that of an occurrence rescheduled elsewhere.
- `recurrence-scope-options.ts`: Which of Only this, This and following and Entire series a save or delete can use, and the dialog's line saying why any is off. It turns a scope off before the server would refuse it where the app can tell, and reads the server's typed refusal (`seriesRefusalOf`) when it can't, keeping each refused scope off with its reason (`refuseSave`, `refusalReason`: the server's words without its advice). The line then says where the save can still go from the scopes left, and, where none is, what to do.
- `series-edit.ts`: What an edit made through one occurrence sends for its series: only the fields the user changed (`seriesEditFields`; the server lays them over the series and keeps the series' slot when the times are the occurrence's own), and the repeat the save would send after a day move, with the day its words count from (`seriesRepeatForEdit`).
- `state-provider.tsx`: `StateProvider`, which sets the storage adapter, hydrates the config and shared QueryClient atoms, and runs the today-tick refresh. It also declares the typed query meta (`quietError`) both apps' query error handlers read.
- `storage.ts`: Storage adapter interface, persisted atom helper, and web adapter.
- `temporal-utils.ts`: Shared Temporal helpers for date math.
- `types.ts`: Shared auth client types.
