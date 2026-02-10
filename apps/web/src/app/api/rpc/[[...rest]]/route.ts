import { createContext } from "@kompose/api/context";
import { appRouter } from "@kompose/api/routers/index";
import { trace } from "@opentelemetry/api";
import { RatelimitHandlerPlugin } from "@orpc/experimental-ratelimit";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { NextRequest } from "next/server";

const tracer = trace.getTracer("kompose-api");

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new RatelimitHandlerPlugin()],
});
const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
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
    prefix: "/api/rpc",
    context,
  });
  if (rpcResult.response) {
    return rpcResult.response;
  }

  const apiResult = await apiHandler.handle(req, {
    prefix: "/api/rpc/api-reference",
    context,
  });
  if (apiResult.response) {
    return apiResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
