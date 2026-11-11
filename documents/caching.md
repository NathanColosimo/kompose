# Caching

## Overview

Google Calendar API data is cached in Redis to reduce latency. Webhooks handle real-time invalidation; TTLs are safety nets only.

```
Client request
  ▼
getLinkedAccount (ownership + current linkage check)
  ▼
Cache lookup (Redis GET, key scoped to the user and local account row)
  ├── HIT  → return cached data
  └── MISS → getGoogleCalendar (access token)
             → fetch from Google API → populate cache → return
```

---

## Architecture

**Service:** `GoogleCalendarCacheService` (`packages/api/src/routers/google-cal/cache.ts`)

A `Context.Service` with a `Layer.effect` layer. Each method is wrapped in `Effect.fn` for automatic tracing spans and annotated with relevant IDs (`accountId`, `calendarId`, `eventId`, etc.) for OTel visibility. The methods build keys and call the shared best-effort JSON cache, `makeRedisJsonCache` (`packages/api/src/lib/redis-cache.ts`), which `WhoopCacheService` uses too.

**Redis client:** the shared `redis` connection from `@kompose/redis` (ioredis, `REDIS_URL`), which Better Auth, the rate limiters, the WHOOP cache and sync publishes use too.

**Errors:** none. No cache method can fail; see [Error Handling](#error-handling).

---

## What's Cached

| Resource | Key pattern | TTL | Used by |
|----------|-------------|-----|---------|
| Calendar list | `gcal:cals:{userId}:{accountId}` | 24h | `calendars.list` |
| Single calendar | `gcal:cal:{userId}:{accountId}:{calendarId}` | 24h | `calendars.get` |
| Colors | `gcal:colors:{userId}:{accountId}` | 24h | `colors.list` |
| Event list | `gcal:events:{userId}:{accountId}:{calendarId}:{timeMin}:{timeMax}` | 24h | `events.list` |
| Single event | `gcal:event:{userId}:{accountId}:{calendarId}:{eventId}` | 24h | `events.get` |

TTLs are conservative safety nets. With active webhook subscriptions, data is invalidated in real-time and TTLs rarely trigger.

---

## Cache Methods

### Read operations

| Method | Returns | On error |
|--------|---------|----------|
| `getCachedCalendars(userId, accountId)` | `Option<data>` | Logged, returns `None` |
| `getCachedCalendar(userId, accountId, calendarId)` | `Option<data>` | Logged, returns `None` |
| `getCachedColors(userId, accountId)` | `Option<data>` | Logged, returns `None` |
| `getCachedEvents(userId, accountId, calendarId, timeMin, timeMax)` | `Option<data>` | Logged, returns `None` |
| `getCachedEvent(userId, accountId, calendarId, eventId)` | `Option<data>` | Logged, returns `None` |

### Write operations

| Method | On error |
|--------|----------|
| `setCachedCalendars(userId, accountId, data)` | Logged, swallowed |
| `setCachedCalendar(userId, accountId, calendarId, data)` | Logged, swallowed |
| `setCachedColors(userId, accountId, data)` | Logged, swallowed |
| `setCachedEvents(userId, accountId, calendarId, timeMin, timeMax, data)` | Logged, swallowed |
| `setCachedEvent(userId, accountId, calendarId, eventId, data)` | Logged, swallowed |

### Invalidation operations

| Method | Scope | Used by |
|--------|-------|---------|
| `invalidateCalendars(userId, accountId)` | Deletes calendar list key + SCAN-deletes all `gcal:cal:{userId}:{accountId}:*` single-calendar keys | Webhooks, local calendar mutations |
| `invalidateAllEvents(userId, accountId, calendarId)` | SCAN-deletes all event list keys + all single-event keys for a calendar | Webhooks (unknown which event changed) |
| `invalidateEventLists(userId, accountId, calendarId)` | SCAN-deletes event list keys only | Local mutations (single-event keys unaffected) |
| `invalidateEvent(userId, accountId, calendarId, eventId)` | Deletes a single event key | Local event update/delete |

---

## Invalidation Strategy

### Webhooks (external changes)

Google push notifications trigger broad invalidation because they don't specify which resource changed:

| Webhook type | Invalidation |
|-------------|--------------|
| Calendar list changed | `invalidateCalendars(userId, accountId)` |
| Calendar events changed | `invalidateAllEvents(userId, accountId, calendarId)` |

Handled in `WebhookService.handleGoogleNotification` (`packages/api/src/webhooks/webhook-service.ts`).

### Local mutations (user actions via oRPC)

Local mutations use targeted invalidation since we know exactly what changed:

| Mutation | Invalidation |
|----------|--------------|
| `calendars.create` | `invalidateCalendars` |
| `calendars.update` | `invalidateCalendars` |
| `calendars.delete` | `invalidateCalendars` + `invalidateAllEvents` (concurrent) |
| `events.create` | `invalidateEventLists` (new event, no single-event key to clear) |
| `events.update` | `invalidateEventLists` + `invalidateEvent` (concurrent) |
| `events.move` | `invalidateEventLists` on source + destination + `invalidateEvent` (concurrent) |
| `events.delete` | `invalidateEventLists` + `invalidateEvent` (concurrent) |

Concurrent invalidations use `Effect.all([...], { concurrency: "unbounded", discard: true })`.

For `events.update`, `events.move` and `events.delete`, `invalidateEvent` clears the event written through and, for an occurrence, its series (`recurringEventId`): a series write ("Entire series", "This and following") rewrites or ends the master. These invalidations and the realtime publish run whether the write succeeded or not (`invalidateGoogleCalendarEvents` in `refresh.ts`, via `Effect.ensuring`), since a series write can change Google and still fail part way.

---

## Error Handling

Cache failures never fail a request. `makeRedisJsonCache(logEvent)` handles them in one place:

- A read that fails (Redis error, invalid JSON, or a payload the Zod schema rejects) returns `Option.none()`, a miss.
- A write or delete that fails does nothing.
- Each failure is logged as `logEvent` (`CACHE_ERROR` for Google Calendar, `WHOOP_CACHE_ERROR` for WHOOP) with `{ message, operation }`, so it appears on the request's trace.

Handlers call cache methods directly, with nothing to catch:

```ts
// Reads: a failure is a miss
const cached = yield* cache.getCachedEvents(...);

// Writes and invalidations: a failure is logged and ignored
yield* cache.setCachedEvents(...);
```

---

## SCAN-based Deletion

Prefix-based invalidation uses Redis `SCAN` (not `KEYS`) to avoid blocking Redis. `remove(operation, { keys, prefixes })` in `lib/redis-cache.ts` deletes the exact keys, then SCAN-deletes each prefix:

```ts
let cursor = "0";
do {
  const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
  cursor = nextCursor;
  if (keys.length > 0) {
    await redis.del(...keys);
  }
} while (cursor !== "0");
```

---

## User-Scoped Keys

Every cache key includes the user ID and the local linked account row ID. Each
request resolves that row with `getLinkedAccount` before accessing Redis. Missing
or ambiguous rows fail with `LinkedAccountError`, including on cache hits. A
cache hit does not fetch or refresh an OAuth token.

Unlink deletes the row, so later requests cannot read cached data. Relinking
creates a new row ID and fresh cache keys. In-flight reads keep their original
row ID when writing; they cannot fill the new account's cache. Old entries
expire by TTL.

## Account ID Invariant

Google Calendar inputs, preferences, bootstrap fields and realtime events use
the Google provider account ID (`account.account_id`). Google and WHOOP cache
methods instead receive the owned local row ID (`account.id`). In the key and
method tables above, `{accountId}` denotes that local row ID.

`getLinkedAccount` resolves the provider ID to the user's local row, then
`getLinkedAccessToken` fetches a token for that exact linkage on a cache miss.
Better Auth token, profile, and unlink selectors also use the local row ID.

Webhook cache invalidation uses `webhook_subscription.account_id`, matching
normal cache reads. Realtime payloads still use
`webhook_subscription.provider_account_id`, matching client query keys.

---

## Layer Composition

See [services.md](./services.md#layer-composition) for how `GoogleCalendarCacheService.layer` joins the shared API runtime.
