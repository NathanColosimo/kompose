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
  advanced: {
    // Prefix Better Auth cookies for Kompose.
    cookiePrefix: "kompose",
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: [
    env.NEXT_PUBLIC_WEB_URL,
    "kompose://",
    "exp://",
    "https://appleid.apple.com",
  ],
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      // Support linking additional Google accounts that may use different emails.
      allowDifferentEmails: true,
    },
  },
  socialProviders: {
    google: {
      prompt: "select_account consent",
      accessType: "offline",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: ["https://www.googleapis.com/auth/calendar"],
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
    },
  },
  plugins: [nextCookies(), expo()],
});
