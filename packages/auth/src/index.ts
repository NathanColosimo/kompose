import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { electron } from "@better-auth/electron";
import { expo } from "@better-auth/expo";
import { mcp } from "@better-auth/mcp";
import { db } from "@kompose/db/legacy";
import * as schema from "@kompose/db/schema/auth";
import {
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";
import { env } from "@kompose/env";
import type { PluginProvider } from "@kompose/plugins";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, jwt, lastLoginMethod } from "better-auth/plugins";
import { connectLinkedAccount, reactivateConnection } from "./connections";
import { MCP_RESOURCE, MCP_SCOPE } from "./mcp";
import { pluginOAuthTokens } from "./oauth-tokens";
import { redisSecondaryStorage } from "./redis-storage";
import { cleanUpBeforeUnlink } from "./unlink-cleanup";

export const auth = betterAuth({
  account: {
    // Plaintext tokens from before this still read; the next refresh encrypts them.
    encryptOAuthTokens: true,
    accountLinking: {
      // Support linking additional Google accounts that may use different emails.
      allowDifferentEmails: true,
      enabled: true,
      trustedProviders: ["google", "apple"],
    },
  },
  advanced: {
    cookiePrefix: "kompose",
    // One query instead of two where Better Auth reads a row with its user
    // (OAuth sign-in). Uses the auth relations in @kompose/db's relations.ts.
    database: { joins: true },
  },
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  databaseHooks: {
    account: {
      create: { after: connectLinkedAccount },
      delete: {
        before: (account): Promise<void> =>
          cleanUpBeforeUnlink(account, async () => {
            const result = await auth.api.getAccessToken({
              body: { accountId: account.id, userId: account.userId },
            });
            return result.accessToken;
          }),
      },
      update: { after: reactivateConnection },
    },
  },
  disabledPaths: [
    // jwt() adds a session-to-JWT endpoint we don't use; MCP tokens come from /oauth2/token.
    "/token",
    // Forces a provider token refresh without the lock in oauth-tokens.ts. Nothing calls it.
    "/refresh-token",
    // Returns a linked account's provider access token to any signed-in
    // client. No app calls it. This only closes the HTTP route: the server
    // still reads tokens with `auth.api.getAccessToken`.
    "/get-access-token",
  ],
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
          providerId: "whoop" satisfies PluginProvider,
          // WHOOP only returns a new refresh token when the refresh asks for `offline`.
          refreshTokenParams: { scope: "offline" },
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
    pluginOAuthTokens(),
    // OAuth 2.1 provider for MCP clients (ChatGPT, Claude). See documents/mcp.md.
    // Without this, jwt() also signs a JWT into a `set-auth-jwt` header on
    // every session read. Nothing reads that header.
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      accessTokenExpiresIn: 15 * 60, // seconds; revoking still takes effect at once
      consentPage: "/oauth/consent",
      loginPage: "/login",
      resource: MCP_RESOURCE,
      scopes: ["openid", "profile", "email", "offline_access", MCP_SCOPE],
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
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
  session: {
    // Stay signed in like other apps: the session lasts 60 days and slides
    // forward (at most once a day, the default updateAge) whenever the app
    // checks it, so only 60 days without opening the app signs you out.
    expiresIn: 60 * 24 * 60 * 60,
    // The MCP OAuth provider links grants to session rows, so sessions are
    // also written to Postgres. Reads still hit Redis first.
    storeSessionInDatabase: true,
  },
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
  // Origins a request may come from and a sign-in may redirect back to. A
  // redirect to an app scheme carries the new session, so list only schemes
  // Kompose owns. expo() trusts Expo Go's `exp://` itself, and only when
  // NODE_ENV is development.
  trustedOrigins: [
    env.NEXT_PUBLIC_WEB_URL,
    "kompose://",
    `${ELECTRON_AUTH_SCHEME}:/`,
    "https://appleid.apple.com",
    // The dev server opened by port instead of through Portless.
    ...(env.NEXT_PUBLIC_DEPLOYMENT_ENV === "local"
      ? ["http://localhost:3000"]
      : []),
  ],
});
