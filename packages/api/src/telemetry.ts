import { layerGlobal } from "@effect/opentelemetry/OtelTracer";
import { env } from "@kompose/env";
import { context, propagation, SpanKind, trace } from "@opentelemetry/api";
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
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { ORPCInstrumentation } from "@orpc/opentelemetry";
import { waitUntil } from "@vercel/functions";
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
 * ~540 KB into the /api/rpc server bundle, which every cold start loads.
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

// ── Span processor ───────────────────────────────────────────────────
//    The batch processor, plus two things:
//
//    - It strips noisy Next.js internal attributes before export.
//
//    - On Vercel, it flushes when a request's root span ends (a SERVER span
//      with no local parent), inside waitUntil. Vercel freezes an instance as
//      soon as it responds, so spans left for the 5 s timer arrived late or
//      never. Flushes are coalesced (one running, at most one queued) because
//      the exporter drops batches beyond 30 concurrent exports. Each also
//      waits on the exporter, since the batch's forceFlush doesn't wait for
//      an automatic 512-span export already sending. See otel.md.

const STRIP_ATTRIBUTES = ["next.span_name", "next.span_type"];
const flushAtRequestEnd = env.VERCEL === "1";

function logFlushError(error: unknown): void {
  console.error("OTEL_FLUSH_FAILED", error);
}

class ExportSpanProcessor extends BatchSpanProcessor {
  readonly #exporter: OTLPTraceExporter;
  #lastFlush: Promise<void> = Promise.resolve();
  #queued: Promise<void> | undefined;

  constructor(exporter: OTLPTraceExporter) {
    super({ exporter });
    this.#exporter = exporter;
  }

  override onEnd(span: ReadableSpan): void {
    // Mutate the attributes before the batch serializes the span.
    const attributes = span.attributes as Record<string, unknown>;
    for (const key of STRIP_ATTRIBUTES) {
      delete attributes[key];
    }
    super.onEnd(span);

    const parent = span.parentSpanContext;
    const isRequestRoot =
      span.kind === SpanKind.SERVER &&
      (parent === undefined || parent.isRemote === true);
    if (flushAtRequestEnd && isRequestRoot) {
      waitUntil(this.#flush());
    }
  }

  /** Resolves once an export that started after this call has finished. */
  #flush(): Promise<void> {
    if (!this.#queued) {
      this.#queued = this.#flushAfter(this.#lastFlush);
      this.#lastFlush = this.#queued;
    }
    return this.#queued;
  }

  async #flushAfter(previous: Promise<void>): Promise<void> {
    await previous;
    this.#queued = undefined;
    await this.forceFlush().catch(logFlushError);
    await this.#exporter.forceFlush().catch(logFlushError);
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
        new ExportSpanProcessor(
          new OTLPTraceExporter({
            headers: exporterConfig.headers,
            url: exporterConfig.url,
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
