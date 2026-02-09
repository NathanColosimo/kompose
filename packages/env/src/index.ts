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
    // Optional -- tracing disabled when not set
    AXIOM_API_TOKEN: z.string().min(1).optional(),
    AXIOM_DATASET: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_WEB_URL: z
      .string()
      .min(1)
      .regex(/^https?:\/\//),
    // Optional -- client-side tracing disabled when not set
    NEXT_PUBLIC_AXIOM_API_TOKEN: z.string().min(1).optional(),
    NEXT_PUBLIC_AXIOM_DATASET: z.string().min(1).optional(),
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
    NEXT_PUBLIC_AXIOM_API_TOKEN: process.env.NEXT_PUBLIC_AXIOM_API_TOKEN,
    NEXT_PUBLIC_AXIOM_DATASET: process.env.NEXT_PUBLIC_AXIOM_DATASET,
  },
});
