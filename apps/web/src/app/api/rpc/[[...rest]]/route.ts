import { createContext } from "@kompose/api/context";
import { errorStatusMap } from "@kompose/api/error-status";
import { appRouter } from "@kompose/api/routers/index";
import { trace } from "@opentelemetry/api";
import { RateLimitHandlerPlugin } from "@orpc/ratelimit";
import { RPCHandler } from "@orpc/server/fetch";
import type { NextRequest } from "next/server";

const tracer = trace.getTracer("kompose-api");

const rpcHandler = new RPCHandler(appRouter, {
  errorStatusMap,
  plugins: [new RateLimitHandlerPlugin()],
});

async function handleRequest(req: NextRequest) {
  // Record client-reported request timestamp for network latency visibility.
  // The client sends Date.now() in x-request-start; the delta is one-way latency
  // (subject to clock skew, but useful for spotting outliers).
  const requestStart = req.headers.get("x-request-start");
  if (requestStart) {
    const clientMs = Number.parseInt(requestStart, 10);
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && !Number.isNaN(clientMs)) {
      activeSpan.setAttribute(
        "client.request_start",
        new Date(clientMs).toISOString()
      );
      activeSpan.setAttribute("network.latency_ms", Date.now() - clientMs);
    }
  }

  // Trace session resolution so auth cost is visible in spans
  const context = await tracer.startActiveSpan(
    "createContext",
    async (span) => {
      try {
        return await createContext(req);
      } finally {
        span.end();
      }
    }
  );

  const rpcResult = await rpcHandler.handle(req, {
    context,
    prefix: "/api/rpc",
  });
  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
