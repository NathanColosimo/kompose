import { createContext } from "@kompose/api/context";
import { errorStatusMap } from "@kompose/api/error-status";
import { appRouter } from "@kompose/api/routers/index";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import type { NextRequest } from "next/server";

const generator = new OpenAPIGenerator({
  converters: [new ZodToJsonSchemaConverter()],
});

const apiHandler = new OpenAPIHandler(appRouter, {
  errorStatusMap,
  plugins: [
    new OpenAPIReferenceHandlerPlugin({
      spec: () =>
        generator.generate(appRouter, {
          base: { info: { title: "Kompose API", version: "1.0.0" } },
          errorStatusMap,
        }),
    }),
  ],
});

async function handleRequest(req: NextRequest) {
  const context = await createContext(req);
  const result = await apiHandler.handle(req, {
    context,
    prefix: "/api/rpc/api-reference",
  });

  return result.response ?? new Response("Not found", { status: 404 });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
