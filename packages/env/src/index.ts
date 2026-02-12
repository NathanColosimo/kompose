import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    APPLE_CLIENT_ID: z.string().min(1),
    APPLE_CLIENT_SECRET: z.string().min(1),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().min(1),
    GOOGLE_WEBHOOK_TOKEN: z.string().min(1),
    GOOGLE_MAPS_API_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1).optional(),
    // Optional -- local OTLP endpoint (e.g. http://localhost:4318 for Jaeger)
    // Takes priority over Axiom when set
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    // Optional -- tracing disabled when not set (server-only)
    AXIOM_API_TOKEN: z.string().min(1).optional(),
    AXIOM_DATASET: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_WEB_URL: z
      .string()
      .min(1)
      .regex(/^https?:\/\//),
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
  },
});
