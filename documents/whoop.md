# WHOOP Integration

Surfaces WHOOP health data (recovery, strain, sleep, workouts) on the calendar week view. One WHOOP account per user, linked via OAuth.

## How it works

1. User links their WHOOP account on the settings page via OAuth (Better Auth `genericOAuth` plugin).
2. On the dashboard, Jotai atoms fetch the linked account and day summaries for the visible month window.
3. The server fetches cycles, recoveries, sleeps, and workouts from the WHOOP Developer API v2, groups them by calendar day using a cycle-centric model, and caches per-day payloads in Redis.
4. The frontend renders daily stats as header badges, sleep/naps as background bands, and workouts as timed event blocks.

## OAuth & Account Linking

- Provider ID: `whoop`
- Scopes: `read:profile`, `read:sleep`, `read:workout`, `read:recovery`, `read:cycles`, `offline`
- WHOOP only links. It can't sign anyone in or create a Kompose user; see [Sign-in providers in `plugins.md`](./plugins.md#sign-in-providers)
- `getUserInfo` callback fetches `/developer/v1/user/profile/basic` during the OAuth flow to populate the user's name and email
- Configured in `packages/auth/src/index.ts` under `genericOAuth`

Better Auth 1.7 uses `linkSocial({ provider: "whoop" })` and the shared social
callback route. Register `https://kompose.dev/api/auth/callback/whoop` in the
[WHOOP Developer Dashboard](https://developer.whoop.com/). For development, use
`https://local.kompose.dev/api/auth/callback/whoop`. The previous
`/api/auth/oauth2/callback/whoop` route is no longer used. PKCE stays enabled by
default.

The app's WHOOP RPC inputs use the provider account ID (`account.accountId`).
`getLinkedAccount` resolves it to an owned local row before cache access. Cache
keys use that row's ID, so unlink blocks reads and relink starts fresh.
`getLinkedAccessToken` uses the resolved row when calling Better Auth. Better Auth token,
profile, and unlink APIs require the local row ID (`account.id`).

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
├── service.ts           — WhoopService (day summary aggregation, caching, grouping)
├── cache.ts             — WhoopCacheService (Redis per-day cache)
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

## Caching

**Service:** `WhoopCacheService` (Effect.Service, Redis-backed)

| Resource | Key pattern | TTL |
|----------|-------------|-----|
| Per-day raw data | `whoop:day:{userId}:{accountId}:{YYYY-MM-DD}` | 15 min (today, empty, pending, or incomplete), 7 days (complete past days) |

- Days with no WHOOP data (future days, today before the band syncs, days the band was off) are cached as empty for 15 min and left out of `days.list` responses. Without this, any window containing a future day (the current week or month always does) refetched from WHOOP on every load.
- Past days use seven days only after the cycle closes, recovery and its sleep are present, and no cycle, recovery, sleep, or workout is still pending.
- Cache writes only target days that were actually missing. Cached days are never overwritten by data from an adjacent day's fetch.
- Fetch window starts 6 hours before midnight local time to capture cycles/sleeps that begin in the late evening.
- Cache failures are logged as `WHOOP_CACHE_ERROR` and degrade to API fetches; they never fail requests.

## Webhooks

WHOOP calls `POST /api/webhooks/whoop` when a workout, sleep or recovery of a linked user is updated or deleted (`packages/api/src/webhooks/whoop.ts`). Without it, new data shows up only when a cached day expires (15 minutes) and the client's copy goes stale (10 minutes).

- **Setup:** add `https://kompose.dev/api/webhooks/whoop` under Webhooks in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/), with model version `v2`. One URL covers every user who linked WHOOP. There is no call to register or renew it.
- **Check:** WHOOP signs each call with the app's client secret: `base64(HMAC-SHA256(X-WHOOP-Signature-Timestamp + raw body))` in `X-WHOOP-Signature`. A call that doesn't match gets a 401.
- **Work:** the call carries the WHOOP user ID, the event type, and the ID of the record that changed, not its day. `WhoopService.dataChanged` finds the account linked to that WHOOP user, drops the cached days the record can be on, and publishes a `whoop` sync event. Clients then refetch their WHOOP days; the server answers the untouched days from the cache.
- **Which days:** for an `updated` event it reads the record from WHOOP (`getWorkout`, or `getSleep` for a sleep or recovery event, since a recovery event carries its sleep's ID) and drops from the day before the record starts to the day it ends, in the record's own time zone. A workout this afternoon drops yesterday and today. A record lands on its cycle's wake-up day, which is the day it starts or the day before, and a new sleep also closes the cycle before it.
- **When the days aren't known,** every cached day of the account is dropped: a `deleted` event (the record is gone), or a lookup that fails (logged as `WHOOP_CHANGED_RECORD_LOOKUP_FAILED`).
- **Missed and repeated calls:** WHOOP doesn't promise delivery, and can send a call twice. WHOOP recommends a reconciliation job for missed calls; here the cache expiry does that job on the next read: 15 minutes for today and unfinished days, 7 days for a complete past day. A repeat only clears the cache again, so `trace_id` isn't checked.
- **Unlinking revokes the user's access at WHOOP** (`DELETE /developer/v2/user/access`), as WHOOP asks apps to do. WHOOP then stops sending calls for that user. It is WHOOP's [unlink cleanup](./plugins.md#unlinking): if the revoke fails, it is logged as `PLUGIN_UNLINK_CLEANUP_FAILED` and the unlink goes on; a call for a WHOOP user nobody has linked does nothing.

## oRPC Endpoints

| Endpoint | Input | Output |
|----------|-------|--------|
| `whoop.days.list` | `{ accountId, startDate, endDate, timeZone }` | `WhoopDaySummary[]` |

`WhoopDaySummary` contains: `day`, `cycleId`, `recoveryScore`, `strainScore`, `kilojoule`, `sleepPerformance`, `sleep` (primary overnight sleep), `naps` (array), `workouts` (array).

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
