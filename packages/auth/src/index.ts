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
  trustedOrigins: [
    process.env.NEXT_PUBLIC_WEB_URL as string,
    "mybettertapp://",
    "exp://",
  ],
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      prompt: "select_account",
      accessType: "offline",
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      scope: ["https://www.googleapis.com/auth/calendar"],
    },
  },
  plugins: [nextCookies(), expo()],
});
