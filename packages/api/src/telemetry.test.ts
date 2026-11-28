import { afterAll, expect, mock, test } from "bun:test";
import { context, propagation, SpanKind, trace } from "@opentelemetry/api";
import { serve } from "bun";

const exports: string[] = [];
const collector = serve({
  async fetch(request) {
    exports.push(await request.text());
    return Response.json({});
  },
  port: 0,
});
// Stands in for Vercel, which keeps an instance alive for this work.
const heldFor: Promise<unknown>[] = [];
Object.assign(globalThis, {
  [Symbol.for("@vercel/request-context")]: {
    get: () => ({
      waitUntil: (work: Promise<unknown>) => heldFor.push(work),
    }),
  },
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
  heldFor.length = 0;
  const fromCaller = propagation.extract(context.active(), {
    traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
  });

  trace
    .getTracer("test")
    .startSpan("webhook call", { kind: SpanKind.SERVER }, fromCaller)
    .end();
  await heldFor[0];

  expect(exports.join()).toContain("webhook call");
});

// Vercel freezes an instance once the response is sent, unless it was asked
// to wait before then. Next ends the request span after the response.
test("the instance is held from a request's start until its span is exported", async () => {
  heldFor.length = 0;

  const request = trace
    .getTracer("test")
    .startSpan("held request", { kind: SpanKind.SERVER });
  expect(heldFor).toHaveLength(1);

  request.end();
  await heldFor[0];
  expect(exports.join()).toContain("held request");
});
