import { env } from "@kompose/env";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ORPCInstrumentation } from "@orpc/otel";

// Hoist regex to top-level scope to avoid re-creation on each call
const API_RPC_PATTERN = /\/api\/rpc/;

/**
 * Initialize client-side OpenTelemetry tracing.
 *
 * Call once at app startup (e.g. in a root layout or client-side provider).
 *
 * FetchInstrumentation auto-patches window.fetch so every oRPC call
 * gets a W3C `traceparent` header injected. The backend OTel SDK extracts
 * this header and links server spans as children of the client span,
 * giving end-to-end frontend-to-backend traces in Axiom.
 */
export function initClientTelemetry() {
  const token = env.NEXT_PUBLIC_AXIOM_API_TOKEN;
  const dataset = env.NEXT_PUBLIC_AXIOM_DATASET;
  if (token === undefined || dataset === undefined) {
    return; // No-op when not configured
  }

  // v2.x API: span processors are passed via the constructor
  const provider = new WebTracerProvider({
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: "https://api.axiom.co/v1/traces",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Axiom-Dataset": dataset,
          },
        })
      ),
    ],
  });

  provider.register();

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // Only instrument calls to our API to avoid noise
        propagateTraceHeaderCorsUrls: [API_RPC_PATTERN],
      }),
      new ORPCInstrumentation(),
    ],
  });
}
