# OpenTelemetry

## Architecture Overview

All tracing lives server-side. There is no client-side OTel SDK in either the web or native app — network latency is measured via a lightweight `x-request-start` header instead.

```
Client (web/native)
  │  x-request-start: Date.now()
  │  traceparent: 00-{traceId}-{spanId}-01
  ▼
Next.js API route (apps/web/src/app/api/rpc/[[...rest]]/route.ts)
  │  ← reads x-request-start, sets network.latency_ms on active span
  │  ← createContext (auth session resolution, traced)
  ▼
oRPC handler
  │  ← ORPCInstrumentation auto-creates handler/middleware spans
  ▼
Effect.fn spans
  │  ← each service method is wrapped in Effect.fn("Service.method")
  │  ← all spans flow through the same global TracerProvider
  ▼
BatchSpanProcessor → SpanAttributeFilter → OTLPTraceExporter → Axiom (or Jaeger)
```

---

## Backend Telemetry

**File:** `packages/api/src/telemetry.ts`

### Components

1. **NodeSDK** — owns the single global `TracerProvider` and `OTLPTraceExporter`. Registers `ORPCInstrumentation` for automatic oRPC handler/middleware spans.
2. **Effect `Tracer.layerGlobal`** — bridges `Effect.fn` spans into the same global `TracerProvider` so oRPC and Effect spans share parent-child links.
3. **`SpanAttributeFilter`** — custom `SpanProcessor` wrapper that strips noisy Next.js internal attributes (`next.span_name`, `next.span_type`) before export.

### Exporter priority

| Priority | Source | Target |
|----------|--------|--------|
| 1 | `OTEL_EXPORTER_OTLP_ENDPOINT` | Local endpoint (e.g. Jaeger at `http://localhost:4318`) |
| 2 | `AXIOM_API_TOKEN` + `AXIOM_DATASET` | Axiom remote backend |
| 3 | Neither set | Tracing disabled (no-op) |

### Resource attributes

`autoDetectResources: false` is set on `NodeSDK` to suppress host/process/runtime resource attributes that add noise without actionable value.

### Effect telemetry layer

Exported as `TelemetryLive` — a `Layer<never>` that is merged with service layers at the router level:

```ts
const TaskLive = Layer.merge(TaskService.Default, TelemetryLive);
const GoogleCalLive = Layer.merge(GoogleCalendarCacheService.Default, TelemetryLive);
```

When no exporter is configured, `TelemetryLive` resolves to `Layer.empty` — everything no-ops gracefully.

---

## Next.js Instrumentation Hook

**File:** `apps/web/src/instrumentation.ts`

```ts
export async function register() {
  await import("@kompose/api/telemetry");
}
```

This ensures `NodeSDK.start()` runs at Next.js server startup, **before** Next.js creates its internal root spans (e.g. `BaseServer.handleRequest`, `resolve page components`). Without this, those root spans are created against a no-op provider and never exported, causing "missing parent span" issues in the OTel backend.

---

## Next.js Fetch Auto-Instrumentation

Next.js auto-instruments `fetch()` when it detects a global `TracerProvider`, creating a span per fetch call with the full URL (including query params). This causes high cardinality in the OTel backend.

**Disabled via:** `NEXT_OTEL_FETCH_DISABLED=1` in `.env`

We rely on `Effect.fn` spans for HTTP call observability instead.

---

## Trace Hierarchy

### Effect-based routers (tasks, tags, google-cal)

```
BaseServer.handleRequest (Next.js internal)
└── POST /api/rpc/[[...rest]] (Next.js internal)
    └── handler (ORPCInstrumentation)
        ├── middleware.decorated (ORPCInstrumentation)
        ├── middleware.ratelimit (ORPCInstrumentation)
        ├── validate_input (ORPCInstrumentation)
        ├── handler (ORPCInstrumentation)
        │   ├── checkGoogleAccountIsLinked (Effect.fn)
        │   ├── GoogleCalendarCacheService.getCachedEvents (Effect.fn)
        │   ├── GoogleCalendar.listEvents (Effect.fn via google-cal client)
        │   └── GoogleCalendarCacheService.setCachedEvents (Effect.fn)
        └── validate_output (ORPCInstrumentation)
```

### SSE endpoint (sync)

The sync endpoint returns a long-lived `AsyncGenerator` for Server-Sent Events. The Next.js parent span (`BaseServer.handleRequest`) stays open for the connection lifetime (up to 11 minutes). Child spans finish and flush earlier, so the parent may appear "missing" in the OTel backend until the SSE connection closes.

---

## Network Latency Measurement

Instead of a client-side OTel SDK, both web and native inject a lightweight header:

### Client side

**Web** (`apps/web/src/utils/orpc.ts`):
```ts
headers: async () => {
  if (typeof window !== "undefined") {
    return { "x-request-start": Date.now().toString() };
  }
  // SSR — forward existing headers
  const { headers } = await import("next/headers");
  return Object.fromEntries(await headers());
},
```

**Native** (`apps/native/utils/orpc.ts`):
```ts
headers.set("x-request-start", Date.now().toString());
```

### Server side

**File:** `apps/web/src/app/api/rpc/[[...rest]]/route.ts`

Reads `x-request-start`, computes one-way latency (subject to clock skew), and sets two span attributes:

| Attribute | Value | Purpose |
|-----------|-------|---------|
| `client.request_start` | ISO timestamp | When the client sent the request |
| `network.latency_ms` | `Date.now() - clientMs` | Estimated one-way network latency |

### Distributed tracing correlation

**Native:** Injects a `traceparent` header via `generateTraceparent()` (UUID v7-based) so server traces link back to the client request.

**Web:** oRPC handles `traceparent` propagation automatically via the browser `fetch` integration.

---

## Environment Variables

| Variable | Required | Location | Purpose |
|----------|----------|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | `packages/env` | Local OTLP endpoint (e.g. Jaeger). Takes priority over Axiom |
| `AXIOM_API_TOKEN` | No | `packages/env` | Axiom API token for production tracing |
| `AXIOM_DATASET` | No | `packages/env` | Axiom dataset name |
| `NEXT_OTEL_FETCH_DISABLED` | No | `apps/web/.env` | Set to `1` to disable Next.js fetch auto-instrumentation |

All OTel env vars are server-only (no `NEXT_PUBLIC_` prefix). When neither `OTEL_EXPORTER_OTLP_ENDPOINT` nor `AXIOM_*` are set, tracing is entirely disabled.

---

## Span Attribute Cleanup

The `SpanAttributeFilter` processor strips these attributes before export:

- `next.span_name` — redundant with the span's own `name` field
- `next.span_type` — internal Next.js classification, not actionable

This keeps the Axiom UI clean without losing meaningful data.

---

## Key Design Decisions

1. **No client-side OTel SDK** — avoids CORS issues (Axiom doesn't serve `Access-Control-Allow-Origin`), eliminates bundle size cost, and sidesteps clock skew in cross-origin span stitching. The `x-request-start` header gives sufficient network latency visibility.

2. **Single TracerProvider** — both oRPC (via `ORPCInstrumentation`) and Effect (via `Tracer.layerGlobal`) share the same provider, so parent-child links are preserved across the oRPC → Effect boundary.

3. **`instrumentation.ts` hook** — without this, Next.js creates root request spans before the `NodeSDK` registers its provider, causing orphaned spans. The hook ensures early initialization.

4. **`autoDetectResources: false`** — suppresses `resource.host.*`, `resource.process.*`, `resource.process.runtime.*` attributes that add noise in Axiom without providing useful debugging info.

5. **Fetch instrumentation disabled** — Next.js fetch auto-instrumentation creates high-cardinality spans (one per URL including query params). `Effect.fn` wrapping the Google Calendar client provides the same observability with controlled span names.
