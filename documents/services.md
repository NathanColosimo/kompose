# Webhook Services

## Architecture

Three Effect services handle all webhook operations:

```
WebhookService (orchestrator)
├── GoogleCalendarWebhookService (provider-specific watch logic)
└── WebhookRepositoryService (database layer)
```

Dependencies are declared via `dependencies: [...]` in each service definition, so layers are wired automatically at the root.

## Services

### WebhookRepositoryService

**File:** `packages/api/src/webhooks/webhook-repository-service.ts`

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

**File:** `packages/api/src/webhooks/google-cal/webhook-service.ts`

Google-specific watch management. Depends on `WebhookRepositoryService`.

| Method | Purpose |
|--------|---------|
| `refreshListWatch` | Create or renew a calendar-list watch subscription |
| `refreshEventsWatch` | Create or renew per-calendar event watch subscriptions |
| `deactivateEventsWatch` | Stop watching and deactivate a removed calendar |
| `listCalendarIds` | Fetch the user's calendar IDs from Google |

Accepts a `GoogleCalendar` Effect client via `Effect.provideService` — it does not build clients internally. The caller (`WebhookService`) resolves OAuth tokens and provides the client.

### WebhookService

**File:** `packages/api/src/webhooks/webhook-service.ts`

Top-level orchestrator. Depends on `GoogleCalendarWebhookService` and `WebhookRepositoryService`.

| Method | Purpose |
|--------|---------|
| `refreshAll` | Discover linked accounts, load existing subs, refresh all watches in parallel |
| `handleGoogleNotification` | Validate headers/token, find subscription, publish realtime event |

`refreshAll` processes each account independently — one revoked token does not fail the batch. Per-account errors are logged via `Effect.tapError` and caught so other accounts continue.

`handleGoogleNotification` returns business data only (`{ followUpRefresh? }`). It yields typed errors for invalid requests. The route handler maps errors to HTTP responses.

## Errors

**File:** `packages/api/src/webhooks/errors.ts`

All errors use `Schema.TaggedError` for type-safe, serializable error handling.

| Error | Used by | Meaning |
|-------|---------|---------|
| `WebhookRepositoryError` | Repository service | DB query failed or record not found |
| `WebhookProviderError` | Google cal service | Google API call failed |
| `WebhookAuthError` | Orchestrator | OAuth token retrieval failed or no token available |
| `WebhookValidationError` | Google cal service, orchestrator | Invalid input (bad URL, missing headers, invalid token) |

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

At the route/router level, provide `WebhookService.Default` — all transitive dependencies are resolved automatically via `dependencies`.

```ts
WebhookService.refreshAll({ userId }).pipe(
  Effect.provide(WebhookService.Default)
)
```

## Runtime Entry Points

| Entry point | File | Behavior |
|-------------|------|----------|
| SSE connect | `packages/api/src/routers/sync/router.ts` | Fire-and-forget `refreshAll` then return Redis iterator |
| Google webhook | `apps/web/src/app/api/webhooks/google-calendar/route.ts` | `handleGoogleNotification` → map errors to HTTP → optional follow-up `refreshAll` |
