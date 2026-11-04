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
ExportSpanProcessor (a BatchSpanProcessor) → OTLPTraceExporter → Axiom (or Jaeger)
```

---

## Backend Telemetry

**File:** `packages/api/src/telemetry.ts`

### Components

1. **`TracerProvider`** (`@opentelemetry/sdk-trace`) — the single global provider, with a `BatchSpanProcessor` and `OTLPTraceExporter`. `telemetry.ts` also registers the async-hooks context manager, W3C `traceparent` propagation, and `ORPCInstrumentation` for automatic oRPC handler/middleware spans.
2. **Effect `Tracer.layerGlobal`** — bridges `Effect.fn` spans into the same global `TracerProvider` so oRPC and Effect spans share parent-child links.
3. **`ExportSpanProcessor`** — a `BatchSpanProcessor` subclass that strips noisy Next.js internal attributes (`next.span_name`, `next.span_type`) and, on Vercel, flushes when a request's root span ends (see [Flushing before Vercel freezes the instance](#flushing-before-vercel-freezes-the-instance)).

### Exporter priority

| Priority | Source | Target |
|----------|--------|--------|
| 1 | `OTEL_EXPORTER_OTLP_ENDPOINT` | Local endpoint (e.g. Jaeger at `http://localhost:4318`) |
| 2 | `AXIOM_API_TOKEN` + `AXIOM_DATASET` | Axiom remote backend |
| 3 | Neither set | Tracing disabled (no-op) |

### Resource attributes

The resource is the OTel default (`telemetry.sdk.*`) plus `service.name`. No resource detectors run, so there are no host/process/runtime attributes adding noise without actionable value.

### Why not NodeSDK

`@opentelemetry/sdk-node` statically imports every exporter it can build from env vars (gRPC, protobuf, Prometheus, Zipkin) plus the logs and metrics SDKs. That put ~540 KB into the `/api/rpc` server bundle (2.67 MB → 2.13 MB without it). Every cold start loaded it, and on the Bun runtime (before Node 26) parsed it from source. Wiring the provider by hand halved `register instrumentation` locally (~21 ms → ~10 ms) and saves ~8 MB RSS per instance. Keep new OTel imports to the specific packages, not `sdk-node` or the `@effect/opentelemetry` barrel (import `@effect/opentelemetry/OtelTracer`).

### Effect telemetry layer

Exported as `TelemetryLive` — a `Layer<never>` that is merged into `AppLayer` in `runtime.ts`, so every effectful handler runs with it:

```ts
const AppLayer = Layer.mergeAll(DatabaseLive, TaskService.layer, /* ... */, TelemetryLive);
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

This ensures the `TracerProvider` is registered at Next.js server startup, **before** Next.js creates its internal root spans (e.g. `BaseServer.handleRequest`, `resolve page components`). Without this, those root spans are created against a no-op provider and never exported, causing "missing parent span" issues in the OTel backend.

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
        │   ├── GoogleCalendarCacheService.getCachedEvents (Effect.fn)
        │   ├── getGoogleCalendar → getLinkedAccessToken (Effect.fn, cache miss only)
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

## Flushing before Vercel freezes the instance

Vercel freezes a function instance as soon as it responds, and `BatchSpanProcessor` exports on a 5 s timer. A batch still buffered at that point waits for the instance's next request, or is lost when the instance shuts down without one. Cold instances often serve only a request or two (a dashboard load after idle boots about one per parallel request), so before this most of their spans, including most root spans, never reached Axiom, and spans that did arrive were ingested minutes late.

On Vercel (`VERCEL=1`), `ExportSpanProcessor` calls `waitUntil(flush)` (`@vercel/functions`) when a request's root span ends: a `SERVER` span with no local parent, including one parented by a remote `traceparent`. Vercel keeps the invocation alive until that export finishes. Boot spans (`register instrumentation`, `load route module`) are buffered by then and go out in the same export. Elsewhere (local dev) nothing changes: the batch exports on its timer.

Flushes are coalesced: at most one export runs, with one more queued for spans that end meanwhile. The OTLP exporter drops batches beyond 30 concurrent exports, which a flush per request could reach on a busy instance with a slow export (40 concurrent requests against a 1.5 s export peaked at 2 in flight). Each flush also waits on the exporter's own `forceFlush()`: the processor's only waits for batches it starts, not an automatic export (at 512 buffered spans) already sending, which can carry the request's spans. A failed export is logged as `OTEL_FLUSH_FAILED`.

`waitUntil` from `@vercel/functions` rather than Next's `after()`: span processors run inside Next's tracing code, where `after()` has no request scope to attach to, while `waitUntil` reads Vercel's request context from a global.

---

## Span Attribute Cleanup

`ExportSpanProcessor` strips these attributes before export:

- `next.span_name` — redundant with the span's own `name` field
- `next.span_type` — internal Next.js classification, not actionable

This keeps the Axiom UI clean without losing meaningful data.

---

## Key Design Decisions

1. **No client-side OTel SDK** — avoids CORS issues (Axiom doesn't serve `Access-Control-Allow-Origin`), eliminates bundle size cost, and sidesteps clock skew in cross-origin span stitching. The `x-request-start` header gives sufficient network latency visibility.

2. **Single TracerProvider** — both oRPC (via `ORPCInstrumentation`) and Effect (via `Tracer.layerGlobal`) share the same provider, so parent-child links are preserved across the oRPC → Effect boundary.

3. **`instrumentation.ts` hook** — without this, Next.js creates root request spans before `telemetry.ts` registers its provider, causing orphaned spans. The hook ensures early initialization.

4. **No resource detectors** — suppresses `resource.host.*`, `resource.process.*`, `resource.process.runtime.*` attributes that add noise in Axiom without providing useful debugging info.

5. **Fetch instrumentation disabled** — Next.js fetch auto-instrumentation creates high-cardinality spans (one per URL including query params). `Effect.fn` wrapping the Google Calendar client provides the same observability with controlled span names.

---

## Axiom Trace Explorer Dashboard

**Prod:** [Kompose Traces](https://app.axiom.co/kompose-i1rh/dashboards/efNB7rBxQm5oP4aNdY) (`kompose-api-prod`)
**Local:** [Kompose Traces](https://app.axiom.co/kompose-i1rh/dashboards/Vz0qGWifmO9IvNMsQE) (`kompose-api-local`)
**Source:** `documents/axiom-trace-explorer.dashboard.json`

A Vercel-log-style request explorer designed for operational debugging. Shows one row per HTTP request (not per span) ordered by most recent, with exact endpoint paths, status codes, and trace drill-down.

### Features

- **Request Log (LogStream):** Chronological list of all server requests. Each row shows method, exact endpoint path (extracted from `['attributes.custom']['http.target']`, query params stripped), status code, duration, network latency, and trace ID. Click a trace ID to see the full span waterfall.
- **SmartFilter controls:** Filter by endpoint (dynamic APL dropdown), status class (2xx/3xx/4xx/5xx), or search by trace ID.
- **Stats row:** Request count, error rate %, p95 latency (ms), error count. SSE `sync/events` connections are excluded from latency calculations.
- **TimeSeries:** Request rate and error rate over time.

### APL field paths

Dashboard queries filter to `kind == "server"` spans (one per HTTP request). Custom OTel attributes live in the `attributes.custom` map field and are accessed via bracket notation:

| Field | APL access | Example value |
|-------|------------|---------------|
| Exact URL | `['attributes.custom']['http.target']` | `/api/rpc/tasks/list?nxtPrest=...` |
| Status code | `['attributes.custom']['http.status_code']` | `200` |
| HTTP method | `['attributes.custom']['http.method']` | `POST` |
| Network latency | `['attributes.custom']['network.latency_ms']` | `68` |

Endpoint extraction strips the query params: `extract("^([^?]+)", 1, tostring(['attributes.custom']['http.target']))`.

### Updating the dashboard

Edit `documents/axiom-trace-explorer.dashboard.json`, then deploy via the Axiom v2 API:

```bash
BODY=$(jq '{dashboard: (. | del(.id, .version, .createdAt, .updatedAt, .createdBy, .updatedBy) | .refreshTime = 60)}' documents/axiom-trace-explorer.dashboard.json)
curl -X POST -H "Authorization: Bearer $AXIOM_TOKEN" -H "X-Axiom-Org-Id: kompose-i1rh" -H "Content-Type: application/json" -d "$BODY" "https://api.axiom.co/v2/dashboards"
# Note: The v2 API creates a new dashboard (no in-place update). Delete the old one from the Axiom UI afterwards.
```
