# WHOOP Integration

Surfaces WHOOP health data (recovery, strain, sleep, workouts) on the calendar week view. One WHOOP account per user, linked via OAuth.

## How it works

1. User links their WHOOP account on the settings page via OAuth (Better Auth `genericOAuth` plugin).
2. On the dashboard, Jotai atoms fetch the linked account and day summaries for the visible month window.
3. The server fetches cycles, recoveries, sleeps, and workouts from the WHOOP Developer API v2, groups them by calendar day using a cycle-centric model, and stores them in Postgres. Reads answer from the stored rows.
4. The frontend renders daily stats as header badges, sleep/naps as background bands, and workouts as timed event blocks.

## OAuth & Account Linking

- Provider ID: `whoop`
- Scopes: `read:profile`, `read:sleep`, `read:workout`, `read:recovery`, `read:cycles`, `offline`
- Limited to one WHOOP account per user (`disableSignUp: true` prevents WHOOP from creating new Kompose accounts)
- `getUserInfo` callback fetches `/developer/v1/user/profile/basic` during the OAuth flow to populate the user's name and email
- Configured in `packages/auth/src/index.ts` under `genericOAuth`

Better Auth 1.7 uses `linkSocial({ provider: "whoop" })` and the shared social
callback route. Register `https://kompose.dev/api/auth/callback/whoop` in the
[WHOOP Developer Dashboard](https://developer.whoop.com/). For development, use
`https://local.kompose.dev/api/auth/callback/whoop`. The previous
`/api/auth/oauth2/callback/whoop` route is no longer used. PKCE stays enabled by
default.

The app's WHOOP RPC inputs use the provider account ID (`account.accountId`).
The service resolves it to the user's own WHOOP connection before it reads any
row. Stored rows belong to the connection, so unlinking deletes them and
relinking starts fresh. `getLinkedAccessToken` uses the account row when
calling Better Auth. Better Auth token, profile, and unlink APIs require the
local row ID (`account.id`).

WHOOP refresh tokens work once. `packages/auth/src/oauth-tokens.ts` refreshes
every plugin account's tokens under a row lock, so two requests can't spend the
same one; see [Tokens in `plugins.md`](./plugins.md#tokens). A WHOOP refresh
must also ask for `scope=offline` to get a new refresh token, which is
`refreshTokenParams` on the WHOOP provider in `packages/auth/src/index.ts`.
`oauth-tokens.test.ts` covers the lock against a real Postgres; it skips without
`DATABASE_URL`, so it only runs locally.

## Packages

```
packages/whoop/          — WHOOP API client + schemas (standalone, no app dependencies)
├── src/client.ts        — Effect-based API client (cycles, recoveries, sleeps, workouts)
├── src/errors.ts        — WhoopApiError, WhoopParseError (Schema.TaggedError)
└── src/schema.ts        — Zod schemas for all WHOOP API response types

packages/api/src/routers/whoop/   — oRPC router + Effect service
├── contract.ts          — oRPC contract (days.list)
├── router.ts            — oRPC handler implementations
├── service.ts           — WhoopService (grouping, sync into day_metric and activity, day summaries)
└── errors.ts            — Service-level errors (InvalidRange)

packages/state/src/atoms/whoop-data.ts   — Jotai atoms for frontend state
```

## API Client

`createWhoopClient(accessToken)` returns an object whose methods return typed Effects:

| Method | Returns | Error channel |
|--------|---------|---------------|
| `listCycles(params)` | `WhoopCycle[]` | `WhoopApiError \| WhoopParseError` |
| `listRecoveries(params)` | `WhoopRecovery[]` | `WhoopApiError \| WhoopParseError` |
| `listSleeps(params)` | `WhoopSleep[]` | `WhoopApiError \| WhoopParseError` |
| `listWorkouts(params)` | `WhoopWorkout[]` | `WhoopApiError \| WhoopParseError` |
| `getSleep(id)` | `WhoopSleep` | `WhoopApiError \| WhoopParseError` |
| `getWorkout(id)` | `WhoopWorkout` | `WhoopApiError \| WhoopParseError` |

- Pagination: follows `next_token` with `limit: 25` (API max) per page
- All response bodies are validated against Zod schemas with `.loose()` for forward compatibility

## Day Grouping Model

WHOOP cycles are physiological days that run from sleep-to-sleep (typically ~11pm to ~11pm). The `groupRawDataByDay` function uses a **cycle-centric** approach to assign data to calendar days:

1. Index recoveries and sleeps by `cycle_id`
2. For each cycle, find its associated recovery, sleeps (including naps), and workouts (by time overlap)
3. Determine the **display day** from the primary sleep's end time (the wake-up moment)
4. Assign the entire bundle (cycle + recovery + sleeps + workouts) to that day
5. Active cycles (no sleep yet) fall back to the current date in the cycle's timezone

This matches the WHOOP app presentation: when you open the app on March 14, you see recovery from waking up that morning, strain accumulated during the day, and last night's sleep.

### Why sleep end, not cycle start?

Cycles start when you fall asleep (~11pm), which is the **previous** calendar day. Using `cycle.start` would assign all data one day too early. Sleep end (wake-up time) is the morning of the correct calendar day.

## Storage and sync

WHOOP's data is stored in Postgres, in the two tables every plugin of this kind writes: `day_metric` and `activity` (see [Data tables in `plugins.md`](./plugins.md#data-tables)). `whoop.days.list` answers from them and builds the same day summaries as before.

What one WHOOP day becomes (`toRows` in `service.ts`):

| WHOOP | Row |
| --- | --- |
| The cycle's `kilojoule` | `day_metric` `energy_burned_kcal` |
| The cycle's `strain` | `day_metric` `strain` |
| The recovery's `recovery_score` | `day_metric` `recovery_score` |
| The primary sleep's asleep time and `sleep_performance_percentage` | `day_metric` `sleep_duration_min` and `sleep_performance` |
| Each sleep and nap | `activity` of kind `sleep`, with `asleepMinutes` and `nap` |
| Each workout | `activity` of kind `workout`, titled with its `sport_name`, with `strain` |

Every row's `date` is the display day from the grouping above. A number WHOOP hasn't scored yet has no row.

`WhoopService.sync` fetches a range of days from WHOOP and stores them in place of what was stored for those days, in one transaction. A record WHOOP no longer has goes with it. It runs at three moments:

| When | Days |
| --- | --- |
| A read asks for days before `connection.synced_from` | From the read's first day to `synced_from`. A connection's first read stores the last 90 days too |
| A [webhook](#webhooks) says a record changed | The days that record can be on |
| One of the user's clients connects (`syncRecent`) | The last three days, at most once in 10 minutes per connection |

- **A read of stored days asks WHOOP nothing.** Only a read before `synced_from` waits for WHOOP.
- **The fetch on connect is the catch-up.** WHOOP sends no webhook for a cycle, so a day's strain and energy only change here, and a skipped webhook is made up here. The app reconnects when the user comes back to it, and every 11 minutes while it stays open.
- **The 10-minute limit** is `connection.synced_at`. WHOOP limits the requests an app makes in a day, and a user switching windows would spend them.
- **The fetch window is a day wider than the days asked for,** on both sides: a cycle starts the evening before its day, and the user can be east or west of UTC. Days at the edges of the window come back incomplete, so only the days asked for are stored.
- **Unlinking deletes the rows** with the connection.
- **Each record lands on one day.** A workout that two cycles' windows both cover stays with the first.

## Webhooks

WHOOP calls `POST /api/webhooks/whoop` when a workout, sleep or recovery of a linked user is updated or deleted (`packages/api/src/webhooks/whoop.ts`). Without it, new data shows up only at the next fetch on connect.

- **Setup:** add `https://kompose.dev/api/webhooks/whoop` under Webhooks in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/), with model version `v2`. One URL covers every user who linked WHOOP. There is no call to register or renew it.
- **Check:** WHOOP signs each call with the app's client secret: `base64(HMAC-SHA256(X-WHOOP-Signature-Timestamp + raw body))` in `X-WHOOP-Signature`. A call that doesn't match gets a 401.
- **Work:** the call carries the WHOOP user ID, the event type, and the ID of the record that changed, not its day. `WhoopService.dataChanged` finds the connection of that WHOOP user, fetches and stores the days the record can be on, and publishes a `whoop` sync event. Clients then read their WHOOP days again, from the stored rows.
- **Which days:** for an `updated` event it reads the record from WHOOP (`getWorkout`, or `getSleep` for a sleep or recovery event, since a recovery event carries its sleep's ID) and syncs from the day before the record starts to the day it ends, in the record's own time zone. A workout this afternoon syncs yesterday and today. A record lands on its cycle's wake-up day, which is the day it starts or the day before, and a new sleep also closes the cycle before it.
- **A record that can't be read from WHOOP:** a `deleted` event (the record is gone), or a lookup that fails (logged as `WHOOP_CHANGED_RECORD_LOOKUP_FAILED`). Its days then come from the stored row with that record's ID: the row's day and the day before. A record that was never stored changes nothing.
- **Missed and repeated calls:** WHOOP doesn't promise delivery, and can send a call twice. WHOOP recommends a reconciliation job for missed calls; here the fetch on connect does that job for the last three days. A repeat only stores the same rows again, so `trace_id` isn't checked.
- **Calls that arrive together:** WHOOP sends a sleep's and its recovery's calls at the same moment, so two syncs of the same days run at once. Both write with upserts.
- **Unlinking revokes the user's access at WHOOP** (`DELETE /developer/v2/user/access`), as WHOOP asks apps to do. WHOOP then stops sending calls for that user. It is WHOOP's [unlink cleanup](./plugins.md#unlinking): if the revoke fails, it is logged as `PLUGIN_UNLINK_CLEANUP_FAILED` and the unlink goes on; a call for a WHOOP user nobody has linked does nothing.

## oRPC Endpoints

| Endpoint | Input | Output |
|----------|-------|--------|
| `whoop.days.list` | `{ accountId, startDate, endDate, timeZone }` | `WhoopDaySummary[]` |

`timeZone` is still accepted and no longer used: a record's day comes from its own UTC offset.

`WhoopDaySummary` contains: `day`, `recoveryScore`, `strainScore`, `kilojoule`, `sleepPerformance`, `sleep` (primary overnight sleep), `naps` (array), `workouts` (array).

## Frontend State

WHOOP data uses the same `atomWithQuery` pattern as Google Calendar data. Components read atoms directly via `useAtomValue` — no prop drilling.

| Atom | Purpose |
|------|---------|
| `whoopAccountDataAtom` | Linked WHOOP account (`Account \| null`) |
| `whoopAccountIdAtom` | Derived account ID for query gating |
| `whoopSummariesByDayAtom` | `Map<string, WhoopDaySummary>` keyed by `YYYY-MM-DD` |

- Month-anchored query window with ±7 day padding (stable key for intra-month navigation)
- Previous month data stays visible only for the same account and time zone; unlinking clears the day map immediately. Account ID and time zone are part of the query key.
- 10-minute client `staleTime`

## Calendar UI

### Day Header Badges

Recovery (color-coded dot), strain, sleep %, and calories shown as compact `text-[10px]` badges below the date number. Recovery dot: green (67-100), yellow (34-66), red (0-33). Calories converted from kilojoule client-side.

### Sleep & Nap Bands

Translucent indigo background bands behind all events. Do not participate in collision layout. Each band is clamped to the column's day boundaries so overnight sleep renders on both the evening and morning columns. A frosted-glass pill in the center of the larger segment shows:
- "Sleep" or "Nap" label
- Time range (full, unclamped)
- Duration in bed
- Duration asleep (actual light + deep + REM)

### Workout Blocks

Teal-styled event blocks (`border-teal-600/30`, `bg-teal-500/15`). Participate in collision layout alongside Google events and tasks. Show: strain score, sport name, and time range. Cross-midnight workouts render in both day columns (clamped).

### Cross-Day Rendering

Events spanning midnight (Google events, WHOOP sleep/workouts) are split into per-day segments clamped to midnight boundaries. Google events use `clampEventToDay`. Sleep/workout bands check all visible summaries per column. Tasks stay on their start day with collision layout clamped to 1440 minutes.

## Settings Page

WHOOP gets the same Settings section as every plugin (see `documents/plugins.md`): name and email stored on its connection, and Unlink. The plugin allows one WHOOP account, so Link account is hidden once one is linked.
