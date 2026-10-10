import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { electron } from "@better-auth/electron";
import { expo } from "@better-auth/expo";
import { db } from "@kompose/db/legacy";
// biome-ignore lint/performance/noNamespaceImport: Auth Schema
import * as schema from "@kompose/db/schema/auth";
import {
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";
import { env } from "@kompose/env";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, lastLoginMethod } from "better-auth/plugins";
import { redisSecondaryStorage } from "./redis-storage";
import { whoopOAuthTokens } from "./whoop";

export const auth = betterAuth({
  account: {
    accountLinking: {
      // Support linking additional Google accounts that may use different emails.
      allowDifferentEmails: true,
      enabled: true,
      trustedProviders: ["google", "apple"],
    },
  },
  advanced: {
    cookiePrefix: "kompose",
  },
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  logger: {
    level: "warn",
  },
  plugins: [
    electron({ clientID: ELECTRON_AUTH_CLIENT_ID, cookiePrefix: "kompose" }),
    expo(),
    lastLoginMethod({
      cookieName: "kompose.last_used_login_method",
      storeInDatabase: false,
    }),
    genericOAuth({
      config: [
        {
          accessType: "offline",
          authorizationUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
          clientId: env.WHOOP_CLIENT_ID ?? "",
          clientSecret: env.WHOOP_CLIENT_SECRET ?? "",
          disableSignUp: true,

          getUserInfo: async (tokens) => {
            const response = await fetch(
              "https://api.prod.whoop.com/developer/v1/user/profile/basic",
              {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              }
            );

            if (!response.ok) {
              return null;
            }

            const profile = (await response.json()) as {
              email?: string;
              first_name?: string;
              last_name?: string;
              user_id?: number;
            };

            const id = profile.user_id;
            const email = profile.email;

            if (!(id && email)) {
              return null;
            }

            return {
              email,
              emailVerified: true,
              id: String(id),
              image: undefined,
              name: [profile.first_name, profile.last_name]
                .filter(Boolean)
                .join(" ")
                .trim(),
            };
          },
          providerId: "whoop",
          scopes: [
            "read:profile",
            "read:sleep",
            "read:workout",
            "read:recovery",
            "read:cycles",
            "offline",
          ],
          tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
        },
      ],
    }),
    whoopOAuthTokens(),
    nextCookies(),
  ],
  /** Rate limiting for auth endpoints (sign-in, token refresh, etc.). */
  rateLimit: {
    enabled: true,
    max: 100,
    storage: "secondary-storage",
    window: 60,
  },
  /** Redis-backed storage for sessions and rate limit counters. */
  secondaryStorage: redisSecondaryStorage,
  socialProviders: {
    apple: {
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
    },
    google: {
      accessType: "offline",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
    },
  },
  trustedOrigins: [
    env.NEXT_PUBLIC_WEB_URL,
    "kompose://",
    "kompose-dev://",
    "exp://",
    "http://localhost:3000",
    `${ELECTRON_AUTH_SCHEME}:/`,
    "https://appleid.apple.com",
  ],
});
