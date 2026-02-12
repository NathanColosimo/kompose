# Services

## Architecture Overview

All backend services live in `packages/api/src/`. Routers are aggregated in `packages/api/src/routers/index.ts`:

```
appRouter
├── ai          → AI chat sessions/messages/streaming
├── googleCal   → Google Calendar CRUD
├── maps        → Google Places autocomplete
├── sync        → SSE realtime event stream
├── tags        → Tag CRUD
└── tasks       → Task CRUD (with recurrence)
```

Supporting systems sit alongside routers:

```
packages/api/src/
├── routers/          — oRPC router implementations
├── webhooks/         — Google Calendar push notification services
├── realtime/         — Redis pub/sub + SSE event iterator
├── ratelimit.ts      — Redis-backed rate limiters
├── telemetry.ts      — OpenTelemetry + Effect tracing setup
├── context.ts        — oRPC context (session/user from Better Auth)
└── index.ts          — base middleware (requireAuth)
```

---

## Task Service

### Files

| File | Purpose |
|------|---------|
| `routers/task/client.ts` | `TaskService` (Effect.Service) — business logic + recurrence |
| `routers/task/db.ts` | Database operations wrapped in `Effect.tryPromise` |
| `routers/task/errors.ts` | `Schema.TaggedError` error types |
| `routers/task/contract.ts` | oRPC contract with Temporal date/time codecs |
| `routers/task/router.ts` | oRPC handler implementations |

### TaskService

Uses `Effect.Service` with `accessors: true`. Each method is wrapped in `Effect.fn("TaskService.method")` for automatic tracing spans.

| Method | Purpose |
|--------|---------|
| `listTasks` | Fetch all tasks for a user (with tags) |
| `createTask` | Create a task, optionally with recurrence pattern |
| `updateTask` | Update a task — supports `"this"` and `"following"` scopes for recurring tasks |
| `deleteTask` | Delete a task — supports `"this"` and `"following"` scopes for recurring tasks |

### Errors (`Schema.TaggedError`)

| Error | Meaning |
|-------|---------|
| `TaskRepositoryError` | DB query failed |
| `TaskNotFoundError` | Task not found by ID |
| `InvalidTaskError` | Invalid input (e.g. bad recurrence rule) |

### Router pattern

Handlers call the service directly (no `Effect.gen` wrapper), provide a merged layer (`TaskService.Default` + `TelemetryLive`), and map errors to `ORPCError` via `Effect.match`. Mutating operations publish a realtime `tasks` event via `publishToUserBestEffort`.

```ts
TaskService.listTasks(userId).pipe(
  Effect.map((tasks) => tasks.map(normalizeTaskTags)),
  Effect.provide(TaskLive),
  Effect.match({
    onSuccess: (value) => value,
    onFailure: handleError,
  }),
)
```

---

## Tag Service

### Files

| File | Purpose |
|------|---------|
| `routers/tag/client.ts` | `TagService` (Effect.Service) |
| `routers/tag/db.ts` | Database operations |
| `routers/tag/errors.ts` | `Schema.TaggedError` error types |
| `routers/tag/contract.ts` | oRPC contract with icon schema |
| `routers/tag/router.ts` | oRPC handler implementations |

### TagService

Same pattern as TaskService — `Effect.Service` with `accessors: true`, methods wrapped in `Effect.fn`.

| Method | Purpose |
|--------|---------|
| `listTags` | List all tags for a user |
| `createTag` | Create a tag (name + icon) |
| `updateTag` | Update tag name/icon |
| `deleteTag` | Delete a tag |

### Errors (`Schema.TaggedError`)

| Error | Meaning |
|-------|---------|
| `TagRepositoryError` | DB query failed |
| `TagConflictError` | Tag name already exists |
| `TagNotFoundError` | Tag not found by ID |
| `InvalidTagError` | Invalid input |

---

## Google Calendar Service

### Files

| File | Purpose |
|------|---------|
| `routers/google-cal/contract.ts` | oRPC contract (calendars, events, colors) |
| `routers/google-cal/router.ts` | oRPC handler implementations |
| `routers/google-cal/cache.ts` | `GoogleCalendarCacheService` — Redis caching layer |
| `routers/google-cal/errors.ts` | `Schema.TaggedError` error types (`AccountNotLinkedError`, `CacheError`) |

The actual `GoogleCalendar` Effect client lives in `packages/google-cal/src/client.ts` — the router resolves an OAuth access token per-request and provides `GoogleCalendarLive(accessToken)`.

### Router operations

**Calendars:** `list`, `get`, `create`, `update`, `delete`
**Events:** `list`, `get`, `create`, `update`, `move`, `delete`
**Colors:** `list`

### Pattern

Read handlers check auth first, then cache, then fall through to the Google API on miss. Mutating handlers invalidate relevant cache keys and publish a realtime `google-calendar` event. All handlers use a single `Effect.runPromise` call.

```ts
const program = Effect.gen(function* () {
  const cache = yield* GoogleCalendarCacheService;
  const accessToken = yield* checkGoogleAccountIsLinked(userId, accountId);

  // Cache-first read
  const cached = yield* cache.getCachedCalendars(accountId).pipe(logCacheErrorAndMiss);
  if (Option.isSome(cached)) return cached.value;

  // API fallback
  const data = yield* service.listCalendars();
  yield* cache.setCachedCalendars(accountId, data).pipe(logAndSwallowCacheError);
  return data;
});

return Effect.runPromise(
  program.pipe(
    Effect.provide(GoogleCalLive),
    Effect.match({ onSuccess: (v) => v, onFailure: handleError })
  )
);
```

Cache layer details are documented in [`caching.md`](./caching.md).

### Errors

| Error | Source | Meaning |
|-------|--------|---------|
| `AccountNotLinkedError` | Router | OAuth token retrieval failed |
| `GoogleApiError` | `@kompose/google-cal` | Google API returned an error |
| `GoogleCalendarZodError` | `@kompose/google-cal` | Response failed Zod parse |
| `CacheError` | Cache service | Redis operation failed (always caught and logged, never surfaces to client) |

---

## Maps Service

**File:** `routers/maps/router.ts`

Single `search` endpoint — Google Places autocomplete. No Effect services; uses plain `fetch` against the Places API v1.

- Returns structured suggestions with `description`, `placeId`, `primary`, `secondary`
- Minimum query length: 2 characters
- Rate limited: 20 req/60s (maps-specific) on top of the 200 req/60s global limit
- Structured error logging on API failures

---

## Sync / SSE Service

### Files

| File | Purpose |
|------|---------|
| `routers/sync/contract.ts` | oRPC contract (SSE event stream) |
| `routers/sync/router.ts` | SSE endpoint handler |
| `realtime/events.ts` | Zod schemas for sync event types |
| `realtime/sync.ts` | Redis pub/sub, async event iterator |

### Sync event types

| Type | Payload | Meaning |
|------|---------|---------|
| `google-calendar` | `{ accountId, calendarId }` | Calendar data changed |
| `tasks` | `{}` | Task data changed |
| `ai-chat` | `{ sessionId }` | AI chat session/message/stream state changed |
| `reconnect` | `{}` | Server requests client to reconnect |

### How it works

1. Client opens SSE connection via `sync.events` endpoint
2. Router fires-and-forgets `WebhookService.refreshAll` to ensure Google push notifications are active
3. `createUserSyncEventIterator` subscribes to the Redis channel `user:{userId}` and yields events as they arrive
4. After 11 minutes, a `reconnect` event is pushed and the iterator closes (prevents stale connections)
5. Mutations across other routers (task create/update/delete, calendar CRUD, AI session + stream lifecycle updates) call `publishToUserBestEffort` to push events to the channel

### Redis pub/sub functions

| Function | Purpose |
|----------|---------|
| `publishToUser` | Publish a typed `SyncEvent` to a user's Redis channel |
| `publishToUserBestEffort` | Fire-and-forget version — logs errors, never throws |
| `createUserSyncEventIterator` | Creates an `AsyncGenerator<SyncEvent>` backed by Redis subscription |

---

## Webhook Services

### Architecture

Three Effect services handle Google Calendar push notifications:

```
WebhookService (orchestrator)
├── GoogleCalendarWebhookService (provider-specific watch logic)
└── WebhookRepositoryService (database layer)
```

Dependencies are declared via `dependencies: [...]` in each service definition, so layers are wired automatically at the root.

### WebhookRepositoryService

**File:** `webhooks/webhook-repository-service.ts`

Provider-agnostic database layer. No mention of Google or any specific provider.

| Method | Purpose |
|--------|---------|
| `getAccountsByProvider` | List OAuth accounts for a user by provider |
| `listSubscriptionsForUser` | List subscriptions, optionally filtered by provider |
| `findActiveSubById` | Find an active subscription by primary key (yields error if not found) |
| `touchSubById` | Update `lastNotifiedAt` timestamp |
| `upsertSub` | Insert or update a subscription (conflict on `id`) |
| `deactivateSubById` | Mark a subscription inactive |

### GoogleCalendarWebhookService

**File:** `webhooks/google-cal/webhook-service.ts`

Google-specific watch management. Depends on `WebhookRepositoryService`.

| Method | Purpose |
|--------|---------|
| `refreshListWatch` | Create or renew a calendar-list watch subscription |
| `refreshEventsWatch` | Create or renew per-calendar event watch subscriptions |
| `deactivateEventsWatch` | Stop watching and deactivate a removed calendar |
| `listCalendarIds` | Fetch the user's calendar IDs from Google |

Accepts a `GoogleCalendar` Effect client via `Effect.provideService` — it does not build clients internally. The caller (`WebhookService`) resolves OAuth tokens and provides the client.

### WebhookService

**File:** `webhooks/webhook-service.ts`

Top-level orchestrator. Depends on `GoogleCalendarWebhookService` and `WebhookRepositoryService`.

| Method | Purpose |
|--------|---------|
| `refreshAll` | Discover linked accounts, load existing subs, refresh all watches in parallel |
| `handleGoogleNotification` | Validate headers/token, find subscription, publish realtime event |

`refreshAll` processes each account independently — one revoked token does not fail the batch. Per-account errors are logged via `Effect.tapError` and caught so other accounts continue.

`handleGoogleNotification` returns business data only (`{ followUpRefresh? }`). It yields typed errors for invalid requests. The route handler maps errors to HTTP responses.

### Webhook route handler

**File:** `apps/web/src/app/api/webhooks/google-calendar/route.ts`

A plain Next.js `POST` handler (not an oRPC route). It:

1. Runs `WebhookService.handleGoogleNotification` with the incoming request headers
2. Maps `WebhookValidationError` → 400, `WebhookRepositoryError` → 202 via `Effect.catchTags`
3. On success, if `result.followUpRefresh` is set, fire-and-forgets a `WebhookService.refreshAll`
4. Returns 200 OK

### Errors (`Schema.TaggedError`)

| Error | Used by | Meaning |
|-------|---------|---------|
| `WebhookRepositoryError` | Repository service | DB query failed or record not found |
| `WebhookProviderError` | Google cal service | Google API call failed |
| `WebhookAuthError` | Orchestrator | OAuth token retrieval failed |
| `WebhookValidationError` | Google cal service, orchestrator | Invalid input (bad URL, missing headers, invalid token) |

---

## Rate Limiting

**File:** `ratelimit.ts`

Redis-backed rate limiters using `@orpc/experimental-ratelimit`.

| Limiter | Limit | Applied to |
|---------|-------|------------|
| `globalRateLimit` | 200 req / 60s per user | All authenticated endpoints |
| `mapsRateLimit` | 20 req / 60s per user | Maps search only (stacks on top of global) |

---

## Telemetry

**File:** `telemetry.ts`

Full details in [`otel.md`](./otel.md). Summary:

1. **`NodeSDK`** — single global `TracerProvider` with `ORPCInstrumentation` for automatic oRPC handler/middleware spans. Exports to Axiom (or local Jaeger) via OTLP HTTP.
2. **`Tracer.layerGlobal`** — bridges `Effect.fn` spans into the same provider. Exported as `TelemetryLive` layer, merged with service layers at the router level.
3. **`SpanAttributeFilter`** — strips noisy Next.js internal attributes before export.
4. **`instrumentation.ts`** — Next.js hook ensuring early `NodeSDK.start()` to prevent orphaned root spans.

No client-side OTel SDK. Network latency is measured via `x-request-start` headers from both web and native clients.

---

## Effect Patterns

### Service definition

Services use `Effect.Service` with `accessors: true` for automatic static accessors and `dependencies: [...]` for automatic layer wiring.

```ts
export class MyService extends Effect.Service<MyService>()("MyService", {
  accessors: true,
  dependencies: [DepA.Default, DepB.Default],
  effect: Effect.gen(function* () {
    const depA = yield* DepA;
    // ...methods...
    return { method1, method2 };
  }),
}) {}
```

### Functions

Every method uses `Effect.fn("Service.method")` for automatic tracing spans.

### Error handling

- Each DB/API call is wrapped individually in `Effect.tryPromise` with a typed `catch` that yields a `Schema.TaggedError`.
- Not-found cases yield errors (not null) so the result is always non-nullable.
- Callers handle errors with `Effect.catchTags` which is compile-time checked — the tag strings must match the error channel.

```ts
// In the service — yield error, don't return null
if (!rows[0]) {
  return yield* new WebhookRepositoryError({
    operation: "find-active-sub-by-id",
    message: "No active subscription found",
  });
}
return rows[0];

// In the route — catchTags maps errors to HTTP responses
Effect.catchTags({
  WebhookValidationError: (e) => Effect.succeed(new Response(e.message, { status: 400 })),
  WebhookRepositoryError: (e) => Effect.succeed(new Response(e.message, { status: 202 })),
})
```

### Layer composition

At the route/router level, provide the service layer — all transitive dependencies are resolved automatically via `dependencies`.

```ts
// Webhook services (auto-wired via dependencies)
WebhookService.refreshAll({ userId }).pipe(
  Effect.provide(WebhookService.Default)
)

// Task/Tag services (merged with TelemetryLive at router level)
const TaskLive = Layer.merge(TaskService.Default, TelemetryLive);
TaskService.listTasks(userId).pipe(
  Effect.provide(TaskLive),
)
```

---

## Runtime Entry Points

| Entry point | File | Behavior |
|-------------|------|----------|
| oRPC handler | `apps/web/src/app/api/rpc/[[...rest]]/route.ts` | All oRPC routes — tasks, tags, google-cal, maps, sync |
| SSE connect | `routers/sync/router.ts` | Fire-and-forget `refreshAll` then return Redis iterator |
| Google webhook | `apps/web/src/app/api/webhooks/google-calendar/route.ts` | `handleGoogleNotification` → map errors to HTTP → optional follow-up `refreshAll` |
