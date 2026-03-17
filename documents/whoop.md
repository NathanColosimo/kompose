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
- Limited to one WHOOP account per user (`disableSignUp: true` prevents WHOOP from creating new Kompose accounts)
- `getUserInfo` callback fetches `/developer/v1/user/profile/basic` during the OAuth flow to populate the user's name and email
- Configured in `packages/auth/src/index.ts` under `genericOAuth`

## Packages

```
packages/whoop/          — WHOOP API client + schemas (standalone, no app dependencies)
├── src/client.ts        — Effect-based API client (cycles, recoveries, sleeps, workouts, profile)
├── src/errors.ts        — WhoopApiError, WhoopParseError (Schema.TaggedError)
└── src/schema.ts        — Zod schemas for all WHOOP API response types

packages/api/src/routers/whoop/   — oRPC router + Effect service
├── contract.ts          — oRPC contract (days.list, profile.get)
├── router.ts            — oRPC handler implementations
├── service.ts           — WhoopService (day summary aggregation, caching, grouping)
├── cache.ts             — WhoopCacheService (Redis per-day cache)
└── errors.ts            — Service-level errors (AccountNotLinked, InvalidRange, CacheError)

packages/state/src/atoms/whoop-data.ts   — Jotai atoms for frontend state
```

## API Client

`createWhoopClient(accessToken)` returns an object whose methods return typed Effects:

| Method | Returns | Error channel |
|--------|---------|---------------|
| `getProfileBasic()` | `WhoopProfileBasic` | `WhoopApiError \| WhoopParseError` |
| `listCycles(params)` | `WhoopCycle[]` | `WhoopApiError \| WhoopParseError` |
| `listRecoveries(params)` | `WhoopRecovery[]` | `WhoopApiError \| WhoopParseError` |
| `listSleeps(params)` | `WhoopSleep[]` | `WhoopApiError \| WhoopParseError` |
| `listWorkouts(params)` | `WhoopWorkout[]` | `WhoopApiError \| WhoopParseError` |

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
| Per-day raw data | `whoop:day:{accountId}:{YYYY-MM-DD}` | 15 min (today), 7 days (past) |

- Only days WITH data are cached. Days with no WHOOP data are never cached (they're always refetched in case data appears later).
- Cache writes only target days that were actually missing. Cached days are never overwritten by data from an adjacent day's fetch.
- Fetch window starts 6 hours before midnight local time to capture cycles/sleeps that begin in the late evening.
- Cache errors are logged and swallowed — cache failures degrade to API fetches, never fail requests.

## oRPC Endpoints

| Endpoint | Input | Output |
|----------|-------|--------|
| `whoop.days.list` | `{ accountId, startDate, endDate, timeZone }` | `WhoopDaySummary[]` |
| `whoop.profile.get` | `{ accountId }` | `{ firstName, lastName, email }` |

`WhoopDaySummary` contains: `day`, `cycleId`, `recoveryScore`, `strainScore`, `kilojoule`, `sleepPerformance`, `sleep` (primary overnight sleep), `naps` (array), `workouts` (array).

## Frontend State

WHOOP data uses the same `atomWithQuery` pattern as Google Calendar data. Components read atoms directly via `useAtomValue` — no prop drilling.

| Atom | Purpose |
|------|---------|
| `whoopAccountDataAtom` | Linked WHOOP account (`Account \| null`) |
| `whoopAccountIdAtom` | Derived account ID for query gating |
| `whoopSummariesByDayAtom` | `Map<string, WhoopDaySummary>` keyed by `YYYY-MM-DD` |

- Month-anchored query window with ±7 day padding (stable key for intra-month navigation)
- `keepPreviousData` for smooth month transitions
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

WHOOP account card matches the Google account card pattern: avatar with initials, full name, email, and unlink button. Profile data fetched via `whoop.profile.get`. Account state reads from `whoopAccountDataAtom` (shared with dashboard).
