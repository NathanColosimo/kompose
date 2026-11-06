# Caching

## Overview

Google Calendar API data is cached in Redis to reduce latency. Webhooks and local mutations advance cache generations; TTLs are safety nets. WHOOP caches raw day data with its existing per-day TTL policy.

Every cache-backed request first checks the current linked account in Postgres. Cache hits require ownership and an existing linkage, but do not fetch or refresh an OAuth token.

```
Client request
  ▼
getLinkedAccount (user + provider + provider account ID → local account row ID)
  ├── missing/ambiguous → LinkedAccountError; no cache access
  └── linked → select cache namespace (user + provider account ID + local row ID)
                 → capture generation for Google calendars/events
                 → Redis GET
                    ├── HIT  → return cached data
                    └── MISS → token for that local row → provider API
                               → populate the captured namespace → return
```

## Architecture

- `GoogleCalendarCacheService` (`packages/api/src/routers/google-cal/cache.ts`) creates read handles with `get` and `set(data)`. Each handle captures its generation **before** the provider fetch. Callers must use the same handle for the read and write.
- `WhoopCacheService` (`packages/api/src/routers/whoop/cache.ts`) receives the linkage checked by `WhoopService` and uses it for both reads and writes. Its TTL selection is unchanged.
- `makeRedisJsonCache` (`packages/api/src/lib/redis-cache.ts`) handles best-effort JSON reads, writes, generation selection and invalidation.
- All use the shared ioredis connection from `@kompose/redis` (`REDIS_URL`), also used by Better Auth, rate limiters and sync publishes.

Service methods use `Effect.fn` tracing and annotate account/calendar/event IDs. Cache failures never fail requests. Linkage errors do fail requests, including cache hits.

## Keys and TTLs

`{link}` below means `{userId}:{providerAccountId}:{localAccountRowId}`. The local row ID changes when an account is unlinked and relinked. Old keys without a row ID are never read by this implementation and expire naturally.

| Resource | Key pattern | TTL |
|----------|-------------|-----|
| Calendar-list generation | `gcal:calendars-generation:{link}` | None |
| Calendar list | `gcal:cals:{link}:{generation}` | 24h |
| Single calendar | `gcal:cal:{link}:{calendarId}:{generation}` | 24h |
| Colors | `gcal:colors:{link}` | 24h |
| Calendar event generation | `gcal:events-generation:{link}:{calendarId}` | None |
| Event list | `gcal:events:{link}:{calendarId}:{timeMin}:{timeMax}:{generation}` | 24h |
| Single event | `gcal:event:{link}:{calendarId}:{eventId}:{generation}` | 24h |
| WHOOP raw day | `whoop:day:{link}:{day}` | Existing per-day TTL policy |

Generation counters do not expire. Expiring or evicting a counter independently of its payloads could resurrect an old namespace. Retired payloads expire by their TTL; invalidation does not scan or delete them. Retired linkage counters remain in Redis.

## Generation invalidation

A missing generation counter means generation `0`. Invalidation atomically `INCR`s the counter once. Event lists and **all** single-event entries in a calendar share one counter, so recurring mutations invalidate cached instances as well as the supplied event ID. Calendar lists and single-calendar entries share a separate counter per linkage.

A request captures generation N, misses the cache, and starts fetching Google data. If a webhook or mutation advances the counter to N+1 while that fetch is pending, the request can only write to N. Later requests select N+1 and cannot reuse the old response. The already-running request may still finish with its fetched response.

There is no `SCAN`, prefix deletion, or separate list/single invalidation pass.

| Trigger | Invalidation |
|---------|--------------|
| Calendar-list webhook | `invalidateCalendars(link)` |
| Events webhook | `invalidateEvents(link, calendarId)` |
| `calendars.create`, `calendars.update` | `invalidateCalendars(link)` |
| `calendars.delete` | Calendar-list generation + deleted calendar's event generation |
| `events.create`, `events.update`, `events.delete` | Calendar's event generation |
| `events.move` | Source and destination event generations |

Independent invalidations run with `Effect.all([...], { concurrency: "unbounded", discard: true })`. Webhooks use the subscription's exact local account row ID, provider account ID and user ID. Watch-channel create/renew/stop behavior is unchanged.

## Linkage lifecycle and account IDs

`getLinkedAccount` (`packages/api/src/lib/linked-account.ts`) selects only the local account ID, filtering by user ID, provider ID and provider account ID. Missing or ambiguous rows yield `LinkedAccountError`; database failures are defects. No positive linkage result is cached across requests.

After unlink completes, subsequent reads fail before touching Redis. Relinking the same provider account creates a different local account row ID and therefore a new Google/WHOOP namespace. In-flight requests keep their original linkage for writes and cannot populate the relinked account's namespace. Unlink does not need a cache-deletion hook; retired data remains inaccessible and expires by TTL.

Google Calendar oRPC inputs, client query keys, calendar preferences, bootstrap `accountId` fields and realtime payloads continue to use Google's **provider account ID** (`account.account_id`). Better Auth token/profile/unlink selectors use the **local row ID** (`account.id`). `getLinkedAccessToken(link)` fetches a token for the exact row resolved before cache access, with no second ownership query.

Webhook subscription rows store both identifiers: `webhook_subscription.account_id` is the local row ID; `provider_account_id` is Google's provider ID. Cache invalidation includes both; realtime events still use only the provider ID.

```ts
const link = yield* getLinkedAccount({
  accountId: input.accountId,
  providerId: "google",
  userId: context.user.id,
});
const cache = yield* GoogleCalendarCacheService;
const entry = yield* cache.events(link, {
  calendarId: input.calendarId,
  ...input.params,
});
const cached = yield* entry.get;
if (Option.isSome(cached)) return cached.value;

const token = yield* getLinkedAccessToken(link);
const google = makeGoogleCalendarService(token);
const data = yield* google.listEvents(
  input.calendarId,
  input.params.timeMin,
  input.params.timeMax
);
yield* entry.set(data);
return data;
```

## Error handling

`makeRedisJsonCache(logEvent)` logs failures as `CACHE_ERROR` for Google or `WHOOP_CACHE_ERROR` for WHOOP, with `{ message, operation }`:

- Failed reads, invalid JSON or schema-invalid payloads return `Option.none()`.
- Failed writes and generation increments are logged and ignored.
- A failed generation lookup disables both reads and writes for that handle. It must not fall back to generation `0`, which may contain obsolete data.

Invalidation remains best effort: a failed `INCR` can leave cached data visible until a later successful invalidation or TTL expiry. There is no retry or durable invalidation queue.

## Regression tests

Run `SKIP_ENV_VALIDATION=1 bun test packages/api/src/lib/cache-lifecycle.test.ts`.

The tests exercise actual oRPC Google handlers, WHOOP service, linkage resolution and cache services. Redis, provider calls and the database query boundary use in-memory fakes. Controlled promises hold provider requests open across invalidation; no sleeps or live credentials are required. Coverage includes late list/single writes, recurring-instance invalidation, generation-read failures, and unlink/relink for every Google cache resource and WHOOP days.

## Layer composition

See [services.md](./services.md#layer-composition) for the shared API runtime.
