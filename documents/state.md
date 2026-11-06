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

- `collision-utils.ts`: Shared collision detection for calendar events (web + native). Calculates column positions, column spans, and z-index for overlapping items. Uses a 30-min side-by-side threshold, max 3 columns, and threshold-aware span expansion so events use full width when adjacent columns are stackable.
- `atoms/command-bar.ts`: Command bar open state and focused task id atoms.
- `atoms/auth.ts`: Auth convenience atoms, including synchronous
  `lastUsedLoginMethodAtom` sourced from the configured auth client.
- `atoms/current-date.ts`: Calendar date, timezone, visible days, event window atoms, and reactive `todayPlainDateAtom` / `nowZonedDateTimeAtom` (refreshed every 60s and on window focus/visibility via `todayTickAtom`).
- `atoms/google-colors.ts`: Google color palette atoms with normalization helpers.
- `account-query-keys.ts`: Shared query keys for linked Better Auth account discovery.
- `atoms/google-data.ts`: Shared linked Better Auth account query, Google-account derivations, per-account calendars, and derived visible calendar ids. The effective visible set is calculated during reads: if no explicit preference is saved yet, all currently loaded calendars are treated as visible. Explicit saved selections are filtered per account only when its calendar-list query succeeds; loading or errored discovery preserves that account's saved ids, including after a failed refresh with cached data. Only a successful linked-account query can exclude an unlinked account. Accounts resolve independently, and derivation never rewrites persisted preferences.
- `atoms/visible-calendars.ts`: Visible calendar selection atoms, shared persistence readiness, and toggle helpers. Missing persisted state remains `null` as "no explicit preference yet".
- `atoms/whoop-data.ts`: WHOOP account derivation from the shared linked-account query, month-anchored day summaries query atom with ±7 day padding and `keepPreviousData`, and derived `whoopSummariesByDayAtom` map. Components read directly via `useAtomValue` — no prop drilling needed.
- `config.ts`: Shared config atom plus helpers for accessing `orpc` and auth client.
- `hooks/use-google-accounts.ts`: Query hook for Google-linked Better Auth `Account` records derived from the shared linked-account query.
- `hooks/use-google-event-mutations.ts`: Create/update/delete Google event mutations. Single-occurrence updates (scope `this`, also the default) optimistically update the cache and roll back on failure. Series updates (`all` / `following`) leave in-flight queries and cached data alone until invalidation on settlement, so a failed series update cannot restore an old snapshot over a concurrent edit.
- `hooks/use-google-events.ts`: Query hook for events, one query per calendar and month window (`eventWindowsAtom`: each month the visible days ±7 touch, so the page after the visible one is already loaded). Events crossing a month boundary come back in both months and are deduped by ID.
- `hooks/use-google-account-profiles.ts`: Shared profile hook for linked Google accounts using Better Auth `OAuth2UserInfo`. It can fetch eagerly, but only surfaces that actually render linked-account metadata should depend on it for display.
- `hooks/use-move-google-event-mutation.ts`: Google event move mutation. Moves do not optimistically change the cache, cancel queries, or snapshot/roll back event lists. Failures notify the user; both source and destination calendars are invalidated on settlement.
- `hooks/use-recurring-event-master.ts`: Recurring master query hook.
- `hooks/use-realtime-sync.ts`: Shared SSE sync hook. Initial connections stay quiet. Every successful resubscription runs broad task/calendar catch-up, including after EOF, transport errors, inactivity, server rotation, and a background pause.
- `realtime-sync-supervisor.ts`: Imperative SSE lifecycle with disabled, connecting, consuming, backoff, blur-grace, paused, and exhausted phases. Each attempt has a generation, abort controller, captured iterator, and inactivity timer. Retired attempts can close only their own iterator and cannot deliver events or change the current attempt. Acquisition and consumption failures share ten retries with exponential backoff (1–30 s). Iterator acquisition and short keepalives do not reset the budget: a resource invalidation or keepalive after 30 s proves health. A 30 s event/keepalive silence also aborts pending acquisition or consumption. Blur/hidden disconnects after 30 s, regardless of incoming messages or duplicate visibility notifications; focus before the deadline keeps the stream. The native wrapper supplies foreground state without disabling/recreating the supervisor. Unmount, sign-out, or disabling sync closes immediately.
- `hooks/use-tasks.ts`: Shared task query + optimistic mutations.
- `hooks/use-link-metadata.ts`: One shared, cancellable in-memory query per URL, with no automatic request retries. See [link-parsing.md](./link-parsing.md).
- `link-metadata.ts`: Metadata query options and current-draft auto-fill guards that preserve explicit title/duration edits.
- `hooks/use-today-tick.ts`: Keeps `todayPlainDateAtom` and `nowZonedDateTimeAtom` fresh by incrementing `todayTickAtom` every 60 seconds and on window focus/visibility change. Mounted in `StateProvider`.
- `task-presentation.ts`: Pure `deriveTaskPresentation(task, ctx)` shared by date sections, tag sections, and search. Returns independent Inbox membership, a section for the target date, and a navigation destination. The context supplies today, now, timezone, and an optional target date (defaults to today).
- `task-search-routing.ts`: Creates and serializes command-bar open requests from the derived destination, including the date for sidebar navigation.
- `hooks/use-task-sections.ts`: Shared Inbox and date sections, partitioned in one pass using `deriveTaskPresentation`. Uses reactive today/now atoms for correct overdue detection across midnight boundaries.
- `hooks/use-tag-task-sections.ts`: Partitions non-recurring tagged tasks in one pass into Overdue/Todo/Done. Evaluates presentation for real today and computes each overdue sort timestamp once, before sorting.
- `state-provider.tsx`: `StateProvider`, which sets the storage adapter, hydrates the config and shared QueryClient atoms, and runs the today-tick refresh.
- `storage.ts`: Storage adapter interface, persisted atom helper, and web adapter.
- `temporal-utils.ts`: Shared Temporal helpers for date math.
- `types.ts`: Shared auth client types.

## Persisted preferences

`createPersistedAtom` in `storage.ts` owns persistence for both the visible-day
count and calendar selection. It returns a writable `valueAtom` and a read-only
`stateAtom` with `{ kind: "loading", revision }` or
`{ kind: "ready", revision, value }`. Reads use the initial value while loading.
The revision is in memory only; storage still contains just the preference's JSON
value. No server data is persisted.

A user write immediately enters `ready` and increments the revision, including
before hydration or the first mount. A storage read may apply only if its captured
revision still matches and its mount is still active. Unmount cleanup discards a
pending read; a later mount can retry while still loading. Ready preferences are
not rehydrated on remount. Missing, invalid JSON, or failed reads finish loading
with the initial value.

Calendar selection uses this same state instead of a separate hydration flag.
`resolvedVisibleCalendarIdsAtom` waits only while the preference is `loading`, so
a user choice is usable immediately even with a storage read pending. `null`
still means no explicit preference, and `[]` means explicitly hide all calendars.

Storage writes run in order per adapter and key, including across atom instances
and Jotai stores. The first write starts immediately; asynchronous writes wait
for the previous write to settle. A failed write does not block later writes;
its rejection is returned to the writer. These rules apply to both localStorage
and the native async SecureStore adapter without platform-specific hydration.
There is no automatic retry or rollback on persistence failure.

`bun test` in `packages/state` covers writes racing older reads for both
preferences, immediate calendar readiness, unmount/remount cancellation,
preference fallback semantics, and ordered async writes after success or failure.

## Task presentation rules

- Inbox contains unfinished, non-recurring tasks without a start date, including legacy rows with an orphaned start time. Inbox membership is independent of date sections: a past-due Inbox task also appears in today's Overdue section.
- Overdue contains unfinished tasks with a due date before today or a scheduled end (`startDate` + `startTime` + duration, in the user's timezone) strictly before now. A due date of today is not overdue. Overdue takes precedence over Planned/Unplanned only in the date view for real today.
- Planned contains unfinished tasks with both a start date matching the selected date and a start time. Historical and future date views retain date-specific Planned/Unplanned sections and have no Overdue section.
- Unplanned contains unfinished tasks with a matching start date and no start time. Today also carries forward older non-recurring untimed tasks unless overdue. Recurring masters and occurrences do not carry forward; their untimed instances stay on their own date unless overdue. A task starting today and due today belongs in Unplanned.
- Done contains completed tasks whose `updatedAt` falls on the selected local date. Tag Done includes all completed tasks, regardless of update date. Tag Todo includes every unfinished non-overdue task in that tag, regardless of its scheduled date; tags exclude both recurring masters and occurrences.
- Search destinations are independent of the currently selected date. Calendar takes precedence for tasks with both scheduling fields, followed by Inbox. Other overdue tasks open today's sidebar with an explicit date, before considering their historical or future start date. Remaining unfinished dated untimed tasks open their own date. Completed untimed tasks updated today open today's sidebar; other completed untimed tasks remain unmapped (search currently excludes completed and recurring tasks).
- Both section hooks retain their existing ordering. Inbox sorts by newest update. Date sections retain query order. Tags sort Overdue by the earliest due-date midnight or scheduled start, Todo by due date then start date (nulls last) then newest update, and Done by newest update.

`bun test` in `packages/state` covers the 64 combinations of start date (null/past/today/future), start time (null/set), due date (null/past/today/future), and completion status, each across past/today/future selected dates. It checks derived membership, both section selectors, search destinations, and whether sidebar navigation mounts the result. Additional cases cover recurrence, overdue boundaries, DST, local completion dates, ordering, and serialized desktop navigation.
