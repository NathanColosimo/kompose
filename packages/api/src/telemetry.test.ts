import { afterAll, expect, mock, test } from "bun:test";
import { context, propagation, SpanKind, trace } from "@opentelemetry/api";
import { serve } from "bun";

const exports: string[] = [];
const nextRequestExported = Promise.withResolvers<void>();
const collector = serve({
  async fetch(request) {
    const body = await request.text();
    exports.push(body);
    if (body.includes("next request")) {
      nextRequestExported.resolve();
    }
    return Response.json({});
  },
  port: 0,
});
mock.module("@kompose/env", () => ({
  env: {
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.url.origin,
    // Export when a request's span ends, as production does.
    VERCEL: "1",
  },
}));
await import("./telemetry");

afterAll(() => collector.stop());

test("a caller's unsampled traceparent doesn't hide its request span", async () => {
  const tracer = trace.getTracer("test");
  const fromCaller = propagation.extract(context.active(), {
    traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
  });

  tracer.startSpan("webhook call", { kind: SpanKind.SERVER }, fromCaller).end();
  tracer.startSpan("next request", { kind: SpanKind.SERVER }).end();
  await nextRequestExported.promise;

  expect(exports.join()).toContain("webhook call");
});
