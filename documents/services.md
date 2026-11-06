# Services

## Architecture Overview

All backend services live in `packages/api/src/`. Routers are aggregated in `packages/api/src/routers/index.ts`:

```
appRouter
├── googleCal   → Google Calendar CRUD
├── maps        → Google Places autocomplete
├── sync        → SSE realtime event stream
├── tags        → Tag CRUD
├── tasks       → Task CRUD (with recurrence)
└── whoop       → WHOOP day summaries + profile
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

Handlers are Effect generators (`.effect(function* ...)` from `@orpc/effect`). Services come from the shared `appRuntime` through the oRPC context, so handlers never provide layers. Handlers don't map errors: a failure reaches the client through its class's `publicError` (see [Client errors](#client-errors)). Mutating operations publish a realtime `tasks` event. See [Effect ↔ oRPC bridge](#effect--orpc-bridge).

```ts
const os = implement(taskContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

list: os.list.effect(function* ({ context }) {
  const tasks = yield* TaskService.use((service) => service.listTasks(context.user.id));
  return tasks.map(normalizeTaskTags);
}),
```

---

## Link Parser Service

### Files

| File | Purpose |
|------|---------|
| `services/link-parser/service.ts` | `LinkParserService` (Effect.Service) — provider detection and metadata fetching |
| `services/link-parser/types.ts` | Zod discriminated union for `linkMeta` (provider variants) |
| `services/link-parser/providers/*.ts` | Provider-specific parsers (Spotify, YouTube, Substack, unknown fallback) |

### LinkParserService

Detects the provider from a URL and fetches metadata via provider APIs or scraping. Returns a `LinkMeta` object (Zod discriminated union on `provider`). Tasks store an array of these objects in a single `links` JSONB column.

| Provider | Source |
|----------|--------|
| Spotify | Spotify API (requires `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) |
| YouTube | YouTube Data API (requires `YOUTUBE_API_KEY`) |
| Substack | Substack REST API (archive search + by-id) |
| unknown | Fallback when provider cannot be detected |

### Endpoint

- `tasks.parseLink` — accepts a single URL, returns parsed metadata (`LinkMeta`). Called per-URL by the client; the client assembles results into the task's `links` array.

Full details in [`link-parsing.md`](./link-parsing.md).

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
| `routers/google-cal/errors.ts` | `Schema.TaggedError` error types (`NonEditableGoogleEventError`) |

The actual `GoogleCalendar` Effect client lives in `packages/google-cal/src/client.ts` — the router resolves an OAuth access token per-request and provides `GoogleCalendarLive(accessToken)`.

### Router operations

**Calendars:** `list`, `get`, `create`, `update`, `delete`
**Events:** `list`, `get`, `create`, `update`, `move`, `delete`
**Colors:** `list`

### Pattern

Read handlers first call `getLinkedAccount` to check ownership and resolve the current local account row ID. The cache namespace includes that row ID, so unlink blocks cache hits and relink cannot reuse old entries. OAuth tokens are fetched only on misses. Mutating handlers advance the relevant cache generation and publish a realtime `google-calendar` event.

```ts
list: os.calendars.list.effect(function* ({ input, context }) {
  const link = yield* getLinkedAccount({
    accountId: input.accountId,
    providerId: "google",
    userId: context.user.id,
  });
  const cache = yield* GoogleCalendarCacheService;
  const entry = yield* cache.calendars(link);
  const cached = yield* entry.get;
  if (Option.isSome(cached)) return cached.value;

  const google = yield* getGoogleCalendar(link);
  const data = yield* google.listCalendars();
  yield* entry.set(data);
  return data;
}),
```

Cache layer details are documented in [`caching.md`](./caching.md).

### Errors

| Error | Source | Meaning |
|-------|--------|---------|
| `LinkedAccountError` | `lib/linked-account.ts` | Account not linked, or Better Auth couldn't refresh its token |
| `GoogleApiError` | `@kompose/google-cal` | Google API returned an error |
| `GoogleCalendarZodError` | `@kompose/google-cal` | Response failed Zod parse |

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
| `realtime/sync.ts` | Redis publish and user-scoped stream entry point |
| `realtime/sync-stream.ts` | Subscription acquisition, coalesced event queue, stream cleanup |

### Sync event types

| Type | Payload | Meaning |
|------|---------|---------|
| `google-calendar` | `{ accountId, calendarId }` | Calendar data changed |
| `tasks` | `{}` | Task data changed |
| `reconnect` | `{}` | Server requests client to reconnect |

### How it works

1. Client opens SSE connection via `sync.events` endpoint
2. Router fires-and-forgets `WebhookService.refreshAll` to ensure Google push notifications are active
3. `createUserSyncEventIterator` awaits subscription to the Redis channel `user:{userId}` before returning its event iterator. oRPC can send headers and its initial SSE comment as soon as a handler returns an iterator, so this acquisition barrier keeps client recovery refetches behind a live subscription. The iterator then yields events as they arrive. Each stream opens its own subscriber connection (`createSubscriber()` in `@kompose/redis`), since a subscribed connection can't run other commands; subscriber auto-resubscription and reconnect retries are disabled. If that connection drops, the stream ends so the client reconnects and catches up instead of silently missing events
4. After 11 minutes, a `reconnect` event is pushed and the iterator closes (prevents stale connections)
5. Mutations across other routers (task create/update/delete, calendar CRUD) call `publishToUser` to push events to the channel
6. When the client disconnects, the request's abort signal closes the iterator right away, which unsubscribes from Redis and ends the function. Clients close the stream 30 s after their window loses focus or is hidden (`use-realtime-sync.ts`), so a backgrounded app stops using function time.

Client note:

- The first successful SSE connection stays quiet. Each later successful subscription runs broad task/calendar recovery invalidation, including after an unexpected EOF, Redis close, transport error, inactivity timeout, planned rotation, or deliberate background pause. Recovery runs after the replacement stream is acquired, so it covers changes missed during the gap. An explicit `reconnect` is a control event; it does not also invalidate before resubscription.
- Both browser focus/visibility and native AppState feed the same supervisor. A backgrounded connection closes after **30 s**; keepalives and repeated background notifications cannot extend that deadline. Returning before the deadline preserves the connection. Disabling/unmounting closes immediately.
- Abort and Redis close race pending `subscribe()` acquisition. Abort disconnects the subscriber immediately, even when the command has not settled; late command rejection is observed. Acquisition, listeners, timers, subscriber lifetime, and tracing cleanup share one scope.
- Pending task invalidations and keepalives each occupy one queue slot; calendar invalidations coalesce by `(accountId, calendarId)`. At 256 pending distinct resources, overflow discards the backlog and ends with `reconnect`, allowing a broad catch-up instead of growing memory without limit.

Regression tests use controlled iterators/clocks in `packages/state/src/realtime-sync-supervisor.test.ts` and a fake Redis subscriber with the real oRPC fetch/SSE transport in `packages/api/src/realtime/sync-stream.test.ts`. The transport test delays subscription and checks that no SSE headers or initial comment can reach the client before acquisition. Run `bun test packages/state/src packages/api/src/realtime/sync-stream.test.ts` without Redis or production credentials.

### Redis pub/sub functions

| Function | Purpose |
|----------|---------|
| `publishToUser` | Publish a typed `SyncEvent` to a user's Redis channel. Best effort: a failure is logged as `SYNC_PUBLISH_ERROR` and never fails the caller |
| `createUserSyncEventIterator` | Resolves an `AsyncGenerator<SyncEvent>` after Redis subscription succeeds |

---

## Webhook Services

### Architecture

Two Effect services handle Google Calendar push notifications:

```
WebhookService (orchestrator)
└── GoogleCalendarWebhookService (provider-specific watch logic)
```

Both use `Database` directly. Their layers provide dependencies at the root.

### GoogleCalendarWebhookService

**File:** `webhooks/google-cal/webhook-service.ts`

Google-specific watch management, backed by `Database`.

| Method | Purpose |
|--------|---------|
| `refreshListWatch` | Create or renew a calendar-list watch subscription |
| `refreshEventsWatch` | Create or renew one calendar's event watch subscription (for IDs from `listCalendarIds`) |
| `deactivateEventsWatch` | Deactivate a removed calendar and return the channel to stop after commit |
| `listCalendarIds` | Fetch the user's calendar IDs from Google, minus holiday calendars, which Google can't watch |

Both refresh methods share `renewWatch`: keep an active channel with more than 12 hours left, otherwise create a replacement with a new channel ID and save it before retiring the old channel. The subscription row's primary key follows the new channel ID; the old remote channel is stopped only after the transaction commits. A failed creation or database rollback leaves the old channel tracked and running. Google stop failures are logged and do not fail reconciliation.

Unsupported event watches are identified by Google's structured `pushNotSupportedForRequestedResource` reason. Their retry times are persisted for seven days in `webhook_account_state.unsupported_until`, independently of channel liveness. An unsupported renewal keeps the existing channel. Removed calendars are pruned from this capability map.

Accepts a `GoogleCalendar` Effect client via `Effect.provideService` — it does not build clients internally. The caller (`WebhookService`) resolves OAuth tokens and provides the client.

### WebhookService

**File:** `webhooks/webhook-service.ts`

Top-level orchestrator. Depends on `GoogleCalendarWebhookService`, `GoogleCalendarCacheService`, and `Database`.

| Method | Purpose |
|--------|---------|
| `refreshAll` | Discover linked accounts, lock each account, read current subs and refresh watches |
| `handleGoogleNotification` | Validate headers/token, find subscription, publish realtime event |

`refreshAll` processes accounts independently. Each account holds a transaction-scoped Postgres advisory lock, keyed by its internal account ID, before rereading the account, capability state, or subscriptions. Concurrent SSE connects therefore see committed replacements rather than racing on the same snapshot. Provider failures are logged per watch so successful watches and unsupported decisions still commit. Database failures roll back the account transaction; old channels are stopped only after commit.

The Better Auth `databaseHooks.account.delete.before` hook in `packages/auth/src/index.ts` calls `stopAccountWatches` before the account and subscription rows cascade away. Cleanup must acquire the same account lock and commit `unlinking_until` intent for one minute before deletion can proceed. Coordination failures reject unlink; waiting for reconciliation is outside the best-effort timeout. That transaction also marks tracked channels inactive, since a remote stop may succeed even if its response is lost. Later reconciles skip accounts with unlink intent. Token resolution and remote channel stops then have a ten-second best-effort budget; Google errors are logged and do not fail unlink. The state row cascades with the account. If deletion itself fails after cleanup, the marker expires and the inactive rows cause the next reconcile to replace even fresh watches. Postgres regression tests in `packages/api/src/webhooks/webhook-service.test.ts` cover a lock held beyond ten seconds, a rejected intent write, and failed deletion after fresh channels stop.

`handleGoogleNotification` accepts only active, unexpired channels and does not write `lastNotifiedAt` (the legacy column remains). It returns business data only (`{ followUpRefresh? }`). It yields typed errors for invalid requests. The route handler maps errors to HTTP responses.

Webhook subscriptions keep both Google account identifiers:

- `accountId` is the Better Auth internal account row id and is used for DB ownership/refresh lookups.
- `providerAccountId` is Google's account id and must be used for Google Calendar cache keys and realtime payloads because clients use that id in query keys and oRPC inputs.

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
| `WebhookRepositoryError` | Orchestrator | No live subscription found |
| `WebhookProviderError` | Google cal service | Google API call failed |
| `WebhookAuthError` | Orchestrator | OAuth token retrieval failed |
| `WebhookValidationError` | Google cal service, orchestrator | Invalid input (bad URL, missing headers, invalid token) |

---

## Rate Limiting

**File:** `ratelimit.ts`

Redis-backed rate limiters using `@orpc/ratelimit`, with a small `RedisRateLimiter` adapter that runs its Lua script (`EVAL`) on the shared `@kompose/redis` connection.

| Limiter | Limit | Applied to |
|---------|-------|------------|
| `globalRateLimit` | 200 req / 60s per user | All authenticated endpoints |
| `mapsRateLimit` | 20 req / 60s per user | Maps search only (stacks on top of global) |

---

## Telemetry

**File:** `telemetry.ts`

Full details in [`otel.md`](./otel.md). Summary:

1. **`TracerProvider`** — single global provider (wired by hand, not `NodeSDK`, to keep cold starts small) with `ORPCInstrumentation` for automatic oRPC handler/middleware spans. Exports to Axiom (or local Jaeger) via OTLP HTTP.
2. **`Tracer.layerGlobal`** — bridges `Effect.fn` spans into the same provider. Exported as `TelemetryLive` layer, merged into `AppLayer` in `runtime.ts`.
3. **`ExportSpanProcessor`** — the batch processor; strips noisy Next.js internal attributes and, on Vercel, flushes when a request ends.
4. **`instrumentation.ts`** — Next.js hook ensuring the provider is registered early to prevent orphaned root spans.

No client-side OTel SDK. Network latency is measured via `x-request-start` headers from both web and native clients.

---

## WHOOP Service

### Files

| File | Purpose |
|------|---------|
| `routers/whoop/contract.ts` | oRPC contract (day summaries, profile) |
| `routers/whoop/router.ts` | oRPC handler implementations |
| `routers/whoop/service.ts` | `WhoopService` (Effect.Service) — day summary aggregation, profile fetch |
| `routers/whoop/cache.ts` | `WhoopCacheService` — Redis caching for per-day raw data |
| `routers/whoop/errors.ts` | `Schema.TaggedError` error types |

The actual WHOOP API client lives in `packages/whoop/src/client.ts` — the service resolves an OAuth access token per-request via Better Auth's generic OAuth plugin.

### Router operations

**Days:** `list` — aggregated day summaries (recovery, strain, sleep, workouts) for a date range
**Profile:** `get` — basic profile info (name, email) for a linked WHOOP account

### WhoopService

Uses `Effect.Service` with `accessors: true`. Depends on `WhoopCacheService`.

| Method | Purpose |
|--------|---------|
| `listDaySummaries` | Fetch cycles, recoveries, sleeps, workouts for a date range; group by day; cache per-day payloads |
| `getProfile` | Fetch basic profile info (first name, last name, email) from WHOOP API |

### Caching

- Per-day raw data cached in Redis via `WhoopCacheService`, after checking the current account linkage. Keys include the local account row ID so relinking starts a new namespace.
- 15-minute TTL for today, empty days, and days with pending scores or an open cycle; 7-day TTL only for settled past days. Future days are never fetched or cached. See `documents/whoop.md`.
- Cache failures are logged as `WHOOP_CACHE_ERROR` and never fail the request (degrade to API fetch).

### Errors (`Schema.TaggedError`)

| Error | Meaning |
|-------|---------|
| `LinkedAccountError` | Account not linked, or Better Auth couldn't refresh its token (`lib/linked-account.ts`) |
| `WhoopApiError` | WHOOP API returned an error |
| `WhoopParseError` | Response failed Zod parse |
| `WhoopInvalidRangeError` | Date range invalid or exceeds 62-day limit |

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

Every service layer is merged once into `AppLayer` in `runtime.ts`, and `appRuntime` (a `ManagedRuntime`) builds it once per process. Layers referenced more than once, like `DatabaseLive`, are built once, so all requests share one Postgres pool. The WHOOP token hook in `@kompose/auth` can't import `appRuntime` (`@kompose/api` depends on `@kompose/auth`), so it has its own runtime; both pass `runtimeMemoMap` from `@kompose/db`, which makes them share the one `DatabaseLive` and its pool. Code outside oRPC handlers runs through the same runtime:

```ts
// Google webhook route
await appRuntime.runPromise(
  WebhookService.use((service) => service.handleGoogleNotification({ headers }))
);
```

Don't `Effect.provide` a service layer per request: each call builds the layer again, including a new Postgres pool.

### Postgres connections

`PgClientLive` (`@effect/sql-pg`, `packages/db/src/index.ts`) closes a pooled connection after 4 minutes unused (`idleTimeout`; the library default is 60 s) and enables TCP keepalive after 60 s idle (`keepAlive`; off by default).

- The pool checks for idle connections on a timer. Vercel suspends an instance that has no requests in flight, so the timer doesn't fire while the instance sleeps. In a local test that froze the process with `SIGSTOP`, the overdue check ran as soon as the process woke, before the waking request's query, and it closed anything idle for longer than `idleTimeout`. With 60 s, any request after a gap of more than a minute opened a new connection (TCP, TLS, startup and SCRAM).
- Supabase doesn't document an idle timeout for client connections to its pooler. Supavisor's own `client_idle_timeout` defaults to 0 (off). In transaction mode an idle client holds no Postgres connection, so keeping it open only uses a pooler client slot.
- If the pooler closes the connection while the instance sleeps, the pool replaces it on the next checkout and the request still succeeds. A connection dropped without a close (for example by a NAT) is what keepalive is for. Vercel doesn't document an idle timeout for its egress. 4 minutes stays under the 350 s that AWS NAT gateways use, which matters if a sleeping instance can't send keepalive probes.
- Vercel's own guide suggests a short idle timeout (about 5 s) with `attachDatabasePool`. That guidance is about connections leaking from suspended instances when the database has few connection slots. `@effect/sql-pg`'s pool isn't one of the pool types `attachDatabasePool` lists, and here the transaction pooler sits between the instances and Postgres.

The Better Auth client (`packages/db/src/legacy.ts`, postgres.js) uses its defaults: no idle timeout, 60 s keepalive, and a lifetime of 30–60 minutes per connection. It already keeps idle connections across suspensions, so it's left as is.

Better Auth reads through the Drizzle relations-v2 adapter with `advanced.database.joins` on. Where it needs a row together with its user (an OAuth sign-in looking up the account's owner, or a user by email with their accounts), it uses one joined query instead of two. The joins go through the auth relations in `packages/db/src/schema/relations.ts`, which follow Better Auth's naming (`account.user`, `session.user`, `user.accounts`, `user.sessions`). Sessions are read from Redis, so `session.user` is only used when a session isn't cached.

### Effect ↔ oRPC bridge

- `createContext` adds `effect/context` (from `appRuntime.context()`) to the oRPC context. `@orpc/effect` runs every `.effect(...)` handler with that context and the request's abort signal, so a cancelled request interrupts its fiber.
- `@orpc/effect` throws a failed handler's error as-is, so middleware sees Effect failures and thrown errors alike.
- Routers start from `implement(contract).$context<Context>()` so the Effect services in the context are typed.

### Client errors

An error reaches the client only if its class says how, with a `publicError` getter: one of oRPC's standard codes (which sets the HTTP status) and a message written for users.

```ts
export class TagConflictError extends Schema.TaggedError<TagConflictError>()(
  "TagConflictError",
  { name: Schema.String }
) {
  get publicError(): PublicError {
    return { code: "CONFLICT", message: `A tag named "${this.name}" already exists.` };
  }
}
```

- `sendPublicErrors` (`errors.ts`) runs once at the root of `appRouter`. It turns an error with a `publicError` into that `ORPCError` and passes everything else through. oRPC sends those as a generic 500 and keeps the details on the server and in traces.
- Put details for logs and traces in the other fields (`message`, `cause`), never in `publicError`. Errors whose `message` is internal, such as `LinkParseError` and `GoogleApiError`, return a fixed public message.
- An `ORPCError` thrown directly (such as `UNAUTHORIZED` from `requireAuth`) is sent unchanged.
- `@kompose/google-cal` and `@kompose/whoop` can't import `PublicError`, so their codes aren't type-checked. An unknown code is ignored and the error is sent as a 500.
- Clients show `errorMessage(error)` from `@kompose/state/errors`: the API's message, a generic one for 500s, or a connection message when the request never reached the API. Shared mutation hooks report failures through the host app's `notifyError` (a toast on web, an alert on native) and roll back optimistic updates.

| Error | Code |
|-------|------|
| `InvalidTagError`, `InvalidTaskError`, `NonEditableGoogleEventError`, `WhoopInvalidRangeError` | `BAD_REQUEST` |
| `TagNotFoundError`, `TaskNotFoundError` | `NOT_FOUND` |
| `TagConflictError` | `CONFLICT` |
| `LinkedAccountError` | `PRECONDITION_FAILED` |
| `LinkParseError` | `UNPROCESSABLE_CONTENT` |
| `GoogleApiError`, `WhoopApiError`, `GoogleMapsError` | `BAD_GATEWAY` |
| Everything else (database, parse, and cache errors, defects) | Generic `INTERNAL_SERVER_ERROR` |

---

## Runtime Entry Points

| Entry point | File | Behavior |
|-------------|------|----------|
| oRPC handler | `apps/web/src/app/api/rpc/[[...rest]]/route.ts` | All oRPC routes — tasks, tags, google-cal, maps, sync |
| SSE connect | `routers/sync/router.ts` | Fire-and-forget `refreshAll` then return Redis iterator |
| Google webhook | `apps/web/src/app/api/webhooks/google-calendar/route.ts` | `handleGoogleNotification` → map errors to HTTP → optional follow-up `refreshAll`, all through `appRuntime` |
