import { expo } from "@better-auth/expo";
import { db } from "@kompose/db";
// biome-ignore lint/performance/noNamespaceImport: Auth Schema
import * as schema from "@kompose/db/schema/auth";
import { env } from "@kompose/env";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { redisSecondaryStorage } from "./redis-storage";

const SAME_SITE_RE = /SameSite=\w+/i;
const SECURE_RE = /;\s*Secure/i;

/**
 * After-hook that rewrites Set-Cookie headers for Tauri cross-origin requests.
 *
 * The Tauri webview (`tauri://localhost`) and the API server are different
 * origins in production. `SameSite=Lax` (Better Auth's default) prevents
 * cookies from being sent on cross-origin fetch, breaking session. This hook
 * rewrites to `SameSite=None; Secure` when the request originates from Tauri.
 *
 * In development (HTTP), the rewrite is skipped because:
 *  1. WKWebView is lenient with SameSite=Lax for localhost cross-origin.
 *  2. SameSite=None requires Secure, but Secure cookies over plain HTTP
 *     may not be stored by WKWebView (Chrome has a localhost exception,
 *     WKWebView does not reliably).
 */
// biome-ignore lint/suspicious/useAwait: createAuthMiddleware requires async return type
const tauriCookieHook = createAuthMiddleware(async (ctx) => {
  // Only rewrite in production (HTTPS). In dev, SameSite=Lax works because
  // WKWebView is lenient with localhost cross-origin requests.
  if (!env.NEXT_PUBLIC_WEB_URL.startsWith("https://")) {
    return;
  }

  const origin = ctx.headers?.get("origin") ?? "";
  if (origin !== "tauri://localhost") {
    return;
  }

  const responseHeaders = ctx.context.responseHeaders;
  if (!responseHeaders) {
    return;
  }

  const cookies = responseHeaders.getSetCookie();
  if (!cookies.length) {
    return;
  }

  // Clear originals and re-add with SameSite=None; Secure.
  responseHeaders.delete("set-cookie");
  for (const cookie of cookies) {
    let patched = cookie.replace(SAME_SITE_RE, "SameSite=None");
    if (!SECURE_RE.test(patched)) {
      patched += "; Secure";
    }
    responseHeaders.append("set-cookie", patched);
  }
});

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
  hooks: {
    after: tauriCookieHook,
  },
  logger: {
    level: "warn",
  },
  plugins: [
    expo(),
    nextCookies(),
    // One-time tokens for cross-context auth (Tauri deep-link OAuth flow).
    oneTimeToken({
      storeToken: "hashed",
    }),
  ],
});
