import { OtelTracer } from "@effect/opentelemetry";
import { env } from "@kompose/env";
import { SpanKind } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type {
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ORPCInstrumentation } from "@orpc/opentelemetry";
import { waitUntil } from "@vercel/functions";
import { Layer } from "effect";

/**
 * Backend telemetry setup for OpenTelemetry + Effect tracing.
 *
 * A single NodeSDK instance owns the global TracerProvider and exporter.
 * Effect bridges into it via Tracer.layerGlobal (reads the global provider)
 * so that oRPC spans AND Effect.fn spans flow through the same exporter.
 *
 * Next.js auto-instruments fetch when it detects a global TracerProvider.
 * We disable that via NEXT_OTEL_FETCH_DISABLED=1 in .env since we rely
 * on Effect.fn spans for observability into HTTP calls instead.
 *
 * Export target priority:
 * - OTEL_EXPORTER_OTLP_ENDPOINT (local dev, e.g. Jaeger at http://localhost:4318)
 * - AXIOM_API_TOKEN + AXIOM_DATASET (production, Axiom)
 * - Neither set → tracing disabled (no-op)
 */

// ── Shared exporter config ──────────────────────────────────────────

interface OtlpExporterConfig {
  headers?: Record<string, string>;
  url: string;
}

function getExporterConfig(): OtlpExporterConfig | null {
  // Local/custom OTLP endpoint takes priority (e.g. Jaeger)
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    return { url: `${otlpEndpoint}/v1/traces` };
  }

  // Axiom remote backend
  const token = env.AXIOM_API_TOKEN;
  const dataset = env.AXIOM_DATASET;
  if (token !== undefined && dataset !== undefined) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Axiom-Dataset": dataset,
      },
      url: "https://api.axiom.co/v1/traces",
    };
  }

  return null;
}

const exporterConfig = getExporterConfig();

// ── Span attribute filter ────────────────────────────────────────────
//    Strips noisy Next.js internal attributes before export.

const STRIP_ATTRIBUTES = new Set(["next.span_name", "next.span_type"]);

class SpanAttributeFilter implements SpanProcessor {
  readonly #delegate: SpanProcessor;

  constructor(delegate: SpanProcessor) {
    this.#delegate = delegate;
  }

  onStart(span: unknown, parentContext: unknown): void {
    this.#delegate.onStart(span as never, parentContext as never);
  }

  onEnd(span: ReadableSpan): void {
    // Mutate the attributes object before the delegate serializes the span
    const attrs = span.attributes as Record<string, unknown>;
    for (const key of STRIP_ATTRIBUTES) {
      delete attrs[key];
    }
    this.#delegate.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.#delegate.forceFlush();
  }
  shutdown(): Promise<void> {
    return this.#delegate.shutdown();
  }
}

// ── Flush when a request's root span ends ─────────────────────────────
//    Vercel freezes an instance as soon as it responds, and the batch
//    processor only exports every 5 s. A batch still buffered at that point
//    waits for the instance's next request, or is lost when the instance is
//    shut down without one. Most cold instances serve only a request or two,
//    so most of their spans never reached Axiom. On Vercel, when a request's
//    root span ends (a SERVER span with no local parent), export what's
//    buffered, including boot spans such as "register instrumentation", and
//    have Vercel keep the invocation alive until it's sent. Elsewhere the
//    batch exports on its timer as before.
//
//    Flushes are coalesced: at most one export runs, with one more queued
//    behind it for spans that end meanwhile. The OTLP exporter drops batches
//    beyond 30 concurrent exports, which one flush per request could reach
//    on a busy instance with a slow export. Each flush also waits on the
//    exporter itself, since the processor's forceFlush only waits for the
//    batches it starts, not an automatic one (at 512 spans) already sending.

const flushAtRequestEnd = env.VERCEL === "1";

function isRequestRoot(span: ReadableSpan): boolean {
  const parent = span.parentSpanContext;
  return (
    span.kind === SpanKind.SERVER &&
    (parent === undefined || parent.isRemote === true)
  );
}

interface Flushable {
  forceFlush(): Promise<void>;
}

function logFlushError(error: unknown) {
  console.error("OTEL_FLUSH_FAILED", error);
}

class FlushAtRequestEnd implements SpanProcessor {
  readonly #delegate: SpanProcessor;
  readonly #exporter: Flushable;
  #running: Promise<void> | undefined;
  #queued: Promise<void> | undefined;

  constructor(delegate: SpanProcessor, exporter: Flushable) {
    this.#delegate = delegate;
    this.#exporter = exporter;
  }

  onStart(span: unknown, parentContext: unknown): void {
    this.#delegate.onStart(span as never, parentContext as never);
  }

  onEnd(span: ReadableSpan): void {
    this.#delegate.onEnd(span);
    if (flushAtRequestEnd && isRequestRoot(span)) {
      waitUntil(this.#flush());
    }
  }

  /** Resolves once an export that started after this call has finished. */
  #flush(): Promise<void> {
    if (this.#queued) {
      return this.#queued;
    }
    if (this.#running) {
      this.#queued = this.#running.then(() => {
        this.#queued = undefined;
        return this.#startFlush();
      });
      return this.#queued;
    }
    return this.#startFlush();
  }

  #startFlush(): Promise<void> {
    this.#running = this.#delegate
      .forceFlush()
      .catch(logFlushError)
      .then(() => this.#exporter.forceFlush())
      .catch(logFlushError)
      .finally(() => {
        this.#running = undefined;
      });
    return this.#running;
  }

  forceFlush(): Promise<void> {
    return this.#delegate.forceFlush();
  }
  shutdown(): Promise<void> {
    return this.#delegate.shutdown();
  }
}

// ── 1. Single NodeSDK — global TracerProvider + exporter ────────────
//    Owns the only TracerProvider. ORPCInstrumentation hooks into it for
//    oRPC handler/middleware spans. The same provider is reused by
//    Effect via Tracer.layerGlobal below.
//
//    autoDetectResources: false disables host/process/runtime resource
//    attributes that add noise without actionable value.

if (exporterConfig) {
  const exporter = new OTLPTraceExporter({
    headers: exporterConfig.headers,
    url: exporterConfig.url,
  });
  const sdk = new NodeSDK({
    autoDetectResources: false,
    instrumentations: [new ORPCInstrumentation()],
    serviceName: "kompose-api",
    spanProcessors: [
      new FlushAtRequestEnd(
        new SpanAttributeFilter(new BatchSpanProcessor(exporter)),
        exporter
      ),
    ],
  });
  sdk.start();
}

// ── 2. Effect telemetry layer ───────────────────────────────────────
//    Tracer.layerGlobal reads the global TracerProvider (registered by
//    the NodeSDK above) instead of creating a separate provider.
//    This means Effect.fn spans are exported through the same exporter
//    as oRPC spans, keeping parent-child links intact. The service name
//    comes from the NodeSDK resource.

function buildTelemetryLayer(): Layer.Layer<never> {
  if (!exporterConfig) {
    return Layer.empty;
  }

  return OtelTracer.layerGlobal;
}

export const TelemetryLive = buildTelemetryLayer();
