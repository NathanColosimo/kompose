import { NodeSdk } from "@effect/opentelemetry";
import { env } from "@kompose/env";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ORPCInstrumentation } from "@orpc/otel";
import { Layer } from "effect";

/**
 * Backend telemetry setup for OpenTelemetry + Effect tracing.
 *
 * Two systems are initialized here:
 * 1. @orpc/otel ORPCInstrumentation -- creates spans for oRPC handlers/middleware
 *    and reads incoming `traceparent` headers for frontend-to-backend correlation.
 * 2. @effect/opentelemetry NodeSdk layer -- bridges Effect.fn spans and
 *    Effect.log events to the same OTel trace provider for export to Axiom.
 */

// 1. Register @orpc/otel instrumentation with the Node OTel SDK.
//    This must happen once at startup, before any requests are processed.
if (env.AXIOM_API_TOKEN && env.AXIOM_DATASET) {
  const sdk = new NodeSDK({
    instrumentations: [new ORPCInstrumentation()],
  });
  sdk.start();
}

// 2. Effect-side telemetry layer (bridges Effect.fn spans to OTel).
//    Returns Layer.empty when AXIOM env vars are not configured,
//    so tracing is a no-op in local dev.
function buildTelemetryLayer(): Layer.Layer<never> {
  const token = env.AXIOM_API_TOKEN;
  const dataset = env.AXIOM_DATASET;
  if (token === undefined || dataset === undefined) {
    return Layer.empty;
  }

  return NodeSdk.layer(() => ({
    resource: { serviceName: "kompose-api" },
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: "https://api.axiom.co/v1/traces",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Axiom-Dataset": dataset,
        },
      })
    ),
  }));
}

export const TelemetryLive = buildTelemetryLayer();
