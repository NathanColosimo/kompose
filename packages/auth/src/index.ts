import { expo } from "@better-auth/expo";
import { db } from "@kompose/db";
// biome-ignore lint/performance/noNamespaceImport: Auth Schema
import * as schema from "@kompose/db/schema/auth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth<BetterAuthOptions>({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: [process.env.CORS_ORIGIN || "", "mybettertapp://", "exp://"],
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies(), expo()],
});
