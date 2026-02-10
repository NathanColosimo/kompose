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
