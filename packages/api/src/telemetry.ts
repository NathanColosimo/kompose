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
 * Share one provider between oRPC and Effect to preserve span parentage.
 * Wiring it directly avoids ~540 KB of NodeSDK exporter/SDK imports on cold
 * starts. See documents/otel.md for setup, export targets and measurements.
 */

interface OtlpExporterConfig {
  headers?: Record<string, string>;
  url: string;
}

function getExporterConfig(): OtlpExporterConfig | null {
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    return { url: `${otlpEndpoint}/v1/traces` };
  }

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

    // A request, or work that runs after its response (a CONSUMER span).
    const parent = span.parentSpanContext;
    const isWorkRoot =
      (span.kind === SpanKind.SERVER || span.kind === SpanKind.CONSUMER) &&
      (parent === undefined || parent.isRemote === true);
    if (flushAtRequestEnd && isWorkRoot) {
      // Keep Vercel alive until buffered spans export; the batch timer can freeze.
      // See documents/otel.md for why waitUntil is needed here.
      waitUntil(this.#flush());
    }
  }

  /** Coalesce flushes to stay below the exporter's 30-concurrent-export limit. */
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
    // The processor doesn't wait for an automatic 512-span export already in flight.
    await this.#exporter.forceFlush().catch(logFlushError);
  }
}

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

function buildTelemetryLayer(): Layer.Layer<never> {
  if (!exporterConfig) {
    return Layer.empty;
  }

  return layerGlobal;
}

export const TelemetryLive = buildTelemetryLayer();
