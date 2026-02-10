import { Resource, Tracer } from "@effect/opentelemetry";
import { env } from "@kompose/env";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ORPCInstrumentation } from "@orpc/otel";
import { Layer } from "effect";

/**
 * Backend telemetry setup for OpenTelemetry + Effect tracing.
 *
 * A single NodeSDK instance owns the global TracerProvider and exporter.
 * Effect bridges into it via Tracer.layerGlobal (reads the global provider)
 * so that oRPC spans AND Effect.fn spans flow through the same exporter.
 *
 * Export target priority:
 * - OTEL_EXPORTER_OTLP_ENDPOINT (local dev, e.g. Jaeger at http://localhost:4318)
 * - NEXT_PUBLIC_AXIOM_API_TOKEN + NEXT_PUBLIC_AXIOM_DATASET (production, Axiom)
 * - Neither set → tracing disabled (no-op)
 */

// ── Shared exporter config ──────────────────────────────────────────

interface OtlpExporterConfig {
  url: string;
  headers?: Record<string, string>;
}

function getExporterConfig(): OtlpExporterConfig | null {
  // Local/custom OTLP endpoint takes priority (e.g. Jaeger)
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    return { url: `${otlpEndpoint}/v1/traces` };
  }

  // Axiom remote backend
  const token = env.NEXT_PUBLIC_AXIOM_API_TOKEN;
  const dataset = env.NEXT_PUBLIC_AXIOM_DATASET;
  if (token !== undefined && dataset !== undefined) {
    return {
      url: "https://api.axiom.co/v1/traces",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Axiom-Dataset": dataset,
      },
    };
  }

  return null;
}

const exporterConfig = getExporterConfig();

// ── 1. Single NodeSDK — global TracerProvider + exporter ────────────
//    Owns the only TracerProvider. ORPCInstrumentation hooks into it for
//    oRPC handler/middleware spans. The same provider is reused by
//    Effect via Tracer.layerGlobal below.

if (exporterConfig) {
  const sdk = new NodeSDK({
    serviceName: "kompose-api",
    traceExporter: new OTLPTraceExporter({
      url: exporterConfig.url,
      headers: exporterConfig.headers,
    }),
    instrumentations: [new ORPCInstrumentation()],
  });
  sdk.start();
}

// ── 2. Effect telemetry layer ───────────────────────────────────────
//    Tracer.layerGlobal reads the global TracerProvider (registered by
//    the NodeSDK above) instead of creating a separate provider.
//    This means Effect.fn spans are exported through the same exporter
//    as oRPC spans, keeping parent-child links intact.

function buildTelemetryLayer(): Layer.Layer<never> {
  if (!exporterConfig) {
    return Layer.empty;
  }

  const ResourceLive = Resource.layer({ serviceName: "kompose-api" });
  return Tracer.layerGlobal.pipe(Layer.provide(ResourceLive));
}

export const TelemetryLive = buildTelemetryLayer();
