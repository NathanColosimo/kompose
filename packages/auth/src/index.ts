import { expo } from "@better-auth/expo";
import { db } from "@kompose/db";
// biome-ignore lint/performance/noNamespaceImport: Auth Schema
import * as schema from "@kompose/db/schema/auth";
import { env } from "@kompose/env";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { lastLoginMethod } from "better-auth/plugins";
import { bearer } from "better-auth/plugins/bearer";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { redisSecondaryStorage } from "./redis-storage";

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  advanced: {
    // Prefix Better Auth cookies for Kompose.
    cookiePrefix: "kompose",
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  /** Redis-backed storage for sessions and rate limit counters. */
  secondaryStorage: redisSecondaryStorage,
  /** Rate limiting for auth endpoints (sign-in, token refresh, etc.). */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "secondary-storage",
  },
  trustedOrigins: [
    env.NEXT_PUBLIC_WEB_URL,
    "kompose://",
    "exp://",
    "http://localhost:3000",
    "tauri://localhost",
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
      trustedProviders: ["google", "apple"],
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
  logger: {
    level: "warn",
  },
  plugins: [
    expo(),
    nextCookies(),
    lastLoginMethod({
      cookieName: "kompose.last_used_login_method",
      storeInDatabase: false,
    }),
    // Bearer token auth for Tauri desktop. The Tauri webview cannot use
    // cookies cross-origin (WKWebView ITP blocks Set-Cookie), so it
    // authenticates via Authorization header instead.
    bearer({ requireSignature: true }),
    // One-time tokens for cross-context auth (Tauri deep-link OAuth flow).
    oneTimeToken({
      storeToken: "hashed",
    }),
  ],
});
