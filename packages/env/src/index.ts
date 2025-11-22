import { createEnv } from "@t3-oss/env-nextjs";
import { Schema } from "effect";

export const env = createEnv({
  server: {
    DATABASE_URL: Schema.standardSchemaV1(Schema.NonEmptyString),
    BETTER_AUTH_SECRET: Schema.standardSchemaV1(Schema.NonEmptyString),
    GOOGLE_CLIENT_ID: Schema.standardSchemaV1(Schema.NonEmptyString),
    GOOGLE_CLIENT_SECRET: Schema.standardSchemaV1(Schema.NonEmptyString),
  },
  client: {
    NEXT_PUBLIC_WEB_URL: Schema.standardSchemaV1(
      Schema.NonEmptyString.pipe(Schema.pattern(/^https?:\/\//))
    ),
  },
  // For Next.js >= 13.4.4, you only need to destructure client variables:
  experimental__runtimeEnv: {
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
  },
});
