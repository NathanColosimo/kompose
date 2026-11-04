import { layerGlobal } from "@effect/opentelemetry/OtelTracer";
import { env } from "@kompose/env";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { ORPCInstrumentation } from "@orpc/opentelemetry";
import { Layer } from "effect";

/**
 * Backend telemetry setup for OpenTelemetry + Effect tracing.
 *
 * A single TracerProvider owns the global tracer and exporter.
 * Effect bridges into it via Tracer.layerGlobal (reads the global provider)
 * so that oRPC spans AND Effect.fn spans flow through the same exporter.
 *
 * This wires the provider by hand instead of using NodeSDK. NodeSDK
 * statically imports every exporter it can build from env vars (gRPC,
 * protobuf, Prometheus, Zipkin) plus the logs and metrics SDKs, which put
 * ~540 KB into the /api/rpc server bundle. Each cold start on Vercel's
 * Bun runtime parses that again, since Bun functions get no bytecode cache.
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

// ── 1. Global TracerProvider + exporter ─────────────────────────────
//    Owns the only TracerProvider. ORPCInstrumentation hooks into it for
//    oRPC handler/middleware spans. The same provider is reused by
//    Effect via Tracer.layerGlobal below.
//
//    Also registers the async-hooks context manager (so spans nest across
//    awaits) and W3C traceparent propagation. The resource is the default
//    one plus service.name; no host/process/runtime detectors run.

if (exporterConfig) {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable()
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(
    new TracerProvider({
      resource: defaultResource().merge(
        resourceFromAttributes({ "service.name": "kompose-api" })
      ),
      spanProcessors: [
        new SpanAttributeFilter(
          new BatchSpanProcessor({
            exporter: new OTLPTraceExporter({
              headers: exporterConfig.headers,
              url: exporterConfig.url,
            }),
          })
        ),
      ],
    })
  );
  registerInstrumentations({ instrumentations: [new ORPCInstrumentation()] });
}

// ── 2. Effect telemetry layer ───────────────────────────────────────
//    Tracer.layerGlobal reads the global TracerProvider (registered
//    above) instead of creating a separate provider.
//    This means Effect.fn spans are exported through the same exporter
//    as oRPC spans, keeping parent-child links intact. The service name
//    comes from the provider's resource.

function buildTelemetryLayer(): Layer.Layer<never> {
  if (!exporterConfig) {
    return Layer.empty;
  }

  return layerGlobal;
}

export const TelemetryLive = buildTelemetryLayer();
