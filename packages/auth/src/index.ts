import { expo } from "@better-auth/expo";
import { db } from "@kompose/db";
// biome-ignore lint/performance/noNamespaceImport: Auth Schema
import * as schema from "@kompose/db/schema/auth";
import { env } from "@kompose/env";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth<BetterAuthOptions>({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: [env.NEXT_PUBLIC_WEB_URL, "mybettertapp://", "exp://"],
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      prompt: "select_account consent",
      accessType: "offline",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: ["https://www.googleapis.com/auth/calendar"],
    },
  },
  plugins: [nextCookies(), expo()],
});
