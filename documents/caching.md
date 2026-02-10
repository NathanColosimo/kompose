# Caching

## Overview

Google Calendar API data is cached in Redis to reduce latency. Webhooks handle real-time invalidation; TTLs are safety nets only.

```
Client request
  ▼
checkGoogleAccountIsLinked (auth first, always)
  ▼
Cache lookup (Redis GET)
  ├── HIT  → return cached data
  └── MISS → fetch from Google API → populate cache → return
```

---

## Architecture

**Service:** `GoogleCalendarCacheService` (`packages/api/src/routers/google-cal/cache.ts`)

An `Effect.Service` with `accessors: true`. Each method is wrapped in `Effect.fn` for automatic tracing spans and annotated with relevant IDs (`accountId`, `calendarId`, `eventId`, etc.) for OTel visibility.

**Redis client:** Dedicated `RedisClient` from Bun, connecting via `REDIS_URL`.

**Error type:** `CacheError` (`Schema.TaggedError`) — always caught and logged, never surfaces to the client.

---

## What's Cached

| Resource | Key pattern | TTL | Used by |
|----------|-------------|-----|---------|
| Calendar list | `gcal:cals:{accountId}` | 24h | `calendars.list` |
| Single calendar | `gcal:cal:{accountId}:{calendarId}` | 24h | `calendars.get` |
| Colors | `gcal:colors:{accountId}` | 24h | `colors.list` |
| Event list | `gcal:events:{accountId}:{calendarId}:{timeMin}:{timeMax}` | 1h | `events.list` |
| Single event | `gcal:event:{accountId}:{calendarId}:{eventId}` | 1h | `events.get` |

TTLs are conservative safety nets. With active webhook subscriptions, data is invalidated in real-time and TTLs rarely trigger.

---

## Cache Methods

### Read operations

| Method | Returns | On error |
|--------|---------|----------|
| `getCachedCalendars(accountId)` | `Option<data>` | Logged, returns `None` |
| `getCachedCalendar(accountId, calendarId)` | `Option<data>` | Logged, returns `None` |
| `getCachedColors(accountId)` | `Option<data>` | Logged, returns `None` |
| `getCachedEvents(accountId, calendarId, timeMin, timeMax)` | `Option<data>` | Logged, returns `None` |
| `getCachedEvent(accountId, calendarId, eventId)` | `Option<data>` | Logged, returns `None` |

### Write operations

| Method | On error |
|--------|----------|
| `setCachedCalendars(accountId, data)` | Logged, swallowed |
| `setCachedCalendar(accountId, calendarId, data)` | Logged, swallowed |
| `setCachedColors(accountId, data)` | Logged, swallowed |
| `setCachedEvents(accountId, calendarId, timeMin, timeMax, data)` | Logged, swallowed |
| `setCachedEvent(accountId, calendarId, eventId, data)` | Logged, swallowed |

### Invalidation operations

| Method | Scope | Used by |
|--------|-------|---------|
| `invalidateCalendars(accountId)` | Deletes calendar list key + SCAN-deletes all `gcal:cal:{accountId}:*` single-calendar keys | Webhooks, local calendar mutations |
| `invalidateCalendar(accountId, calendarId)` | Deletes a single calendar key | Targeted invalidation |
| `invalidateAllEvents(accountId, calendarId)` | SCAN-deletes all event list keys + all single-event keys for a calendar | Webhooks (unknown which event changed) |
| `invalidateEventLists(accountId, calendarId)` | SCAN-deletes event list keys only | Local mutations (single-event keys unaffected) |
| `invalidateEvent(accountId, calendarId, eventId)` | Deletes a single event key | Local event update/delete |

---

## Invalidation Strategy

### Webhooks (external changes)

Google push notifications trigger broad invalidation because they don't specify which resource changed:

| Webhook type | Invalidation |
|-------------|--------------|
| Calendar list changed | `invalidateCalendars(accountId)` |
| Calendar events changed | `invalidateAllEvents(accountId, calendarId)` |

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

---

## Error Handling

Cache errors never fail a request. Two shared helpers handle this:

```ts
/** Log a CacheError at error level (visible in OTel) then swallow it. */
export const logAndSwallowCacheError = <A, R>(
  self: Effect.Effect<A, CacheError, R>
) =>
  self.pipe(
    Effect.catchTag("CacheError", (err) => Effect.logError("CACHE_ERROR", err))
  );

/** Same as above but recovers with Option.none() for cache reads. */
export const logCacheErrorAndMiss = <A, R>(
  self: Effect.Effect<A, CacheError, R>
) =>
  self.pipe(
    Effect.catchTag("CacheError", (err) =>
      Effect.logError("CACHE_ERROR", err).pipe(Effect.map(() => Option.none()))
    )
  );
```

Usage pattern in handlers:

```ts
// Reads — error means cache miss
const cached = yield* cache.getCachedEvents(...).pipe(logCacheErrorAndMiss);

// Writes/invalidations — error is logged and swallowed
yield* cache.setCachedEvents(...).pipe(logAndSwallowCacheError);
```

Errors appear as `CACHE_ERROR` log events in OTel traces.

---

## SCAN-based Deletion

Prefix-based invalidation uses Redis `SCAN` (not `KEYS`) to avoid blocking Redis:

```ts
const scanAndDelete = async (prefix: string) => {
  let cursor = 0;
  do {
    const result = await redis.send("SCAN", [
      cursor.toString(), "MATCH", `${prefix}*`, "COUNT", "100",
    ]);
    cursor = Number(result[0]);
    const keys = result[1];
    if (keys.length > 0) {
      await redis.send("DEL", keys);
    }
  } while (cursor !== 0);
};
```

---

## Auth-First Pattern

Cache lookups happen **after** `checkGoogleAccountIsLinked`, never before. This prevents serving cached data to unauthorized users:

```ts
// 1. Auth check (always first)
const accessToken = yield* checkGoogleAccountIsLinked(userId, accountId);

// 2. Cache lookup (only after auth passes)
const cached = yield* cache.getCachedCalendars(accountId).pipe(logCacheErrorAndMiss);
if (Option.isSome(cached)) return cached.value;

// 3. API fetch on miss
const data = yield* service.listCalendars();

// 4. Populate cache
yield* cache.setCachedCalendars(accountId, data).pipe(logAndSwallowCacheError);
```

---

## Layer Composition

The cache service is provided alongside telemetry via a merged layer:

```ts
const GoogleCalLive = Layer.merge(GoogleCalendarCacheService.Default, TelemetryLive);

// Used in every handler
Effect.runPromise(
  program.pipe(
    Effect.provide(GoogleCalLive),
    Effect.match({ onSuccess, onFailure: handleError })
  )
);
```
