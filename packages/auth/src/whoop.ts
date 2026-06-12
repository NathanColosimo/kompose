import { db } from "@kompose/db/legacy";
import { account as accountTable } from "@kompose/db/schema/auth";
import { env } from "@kompose/env";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const WHOOP_PROVIDER_ID = "whoop";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const TOKEN_REFRESH_WINDOW_MS = 30_000;

const whoopTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
  token_type: z.literal("bearer"),
});

type WhoopTokenResponse = z.infer<typeof whoopTokenResponseSchema>;

type WhoopTokenRequest =
  | {
      type: "accessToken";
      accountId: string;
      userId: string;
    }
  | {
      type: "refreshToken";
      accountId: string;
      userId: string;
    };

interface WhoopTokenBody {
  accountId: string;
  providerId: typeof WHOOP_PROVIDER_ID;
  userId: string;
}

interface WhoopTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  scope: string;
}

function isWhoopTokenBody(value: unknown): value is WhoopTokenBody {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).providerId === WHOOP_PROVIDER_ID &&
    typeof (value as Record<string, unknown>).accountId === "string" &&
    typeof (value as Record<string, unknown>).userId === "string"
  );
}

function scopes(scope: string) {
  return scope.split(",");
}

async function refreshWhoopTokens(refreshToken: string): Promise<WhoopTokens> {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;

  if (!clientId) {
    throw new Error("WHOOP_CLIENT_ID is required");
  }

  if (!clientSecret) {
    throw new Error("WHOOP_CLIENT_SECRET is required");
  }

  const response = await fetch(WHOOP_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`WHOOP token refresh failed: ${response.status}`);
  }

  const token: WhoopTokenResponse = whoopTokenResponseSchema.parse(
    await response.json()
  );

  return {
    accessToken: token.access_token,
    accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    refreshToken: token.refresh_token,
    scope: token.scope.split(" ").join(","),
  };
}

export function getWhoopTokens(request: WhoopTokenRequest) {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accountTable)
      .where(
        and(
          eq(accountTable.accountId, request.accountId),
          eq(accountTable.providerId, WHOOP_PROVIDER_ID),
          eq(accountTable.userId, request.userId)
        )
      )
      .for("update");

    if (!account) {
      throw new Error("WHOOP account not linked");
    }

    if (!account.accessToken) {
      throw new Error("WHOOP access token missing");
    }

    if (!account.accessTokenExpiresAt) {
      throw new Error("WHOOP token expiry missing");
    }

    if (!account.refreshToken) {
      throw new Error("WHOOP refresh token missing");
    }

    if (!account.scope) {
      throw new Error("WHOOP token scope missing");
    }

    if (
      request.type === "accessToken" &&
      account.accessTokenExpiresAt.getTime() - Date.now() >
        TOKEN_REFRESH_WINDOW_MS
    ) {
      return {
        accessToken: account.accessToken,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        refreshToken: account.refreshToken,
        scope: account.scope,
      };
    }

    const token = await refreshWhoopTokens(account.refreshToken);

    await tx
      .update(accountTable)
      .set({
        accessToken: token.accessToken,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshToken: token.refreshToken,
        scope: token.scope,
        updatedAt: new Date(),
      })
      .where(eq(accountTable.id, account.id));

    return token;
  });
}

export function whoopOAuthTokens(): BetterAuthPlugin {
  return {
    id: "whoop-oauth-tokens",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            (ctx.path === "/get-access-token" ||
              ctx.path === "/refresh-token") &&
            isWhoopTokenBody(ctx.body),
          handler: createAuthMiddleware(async (ctx) => {
            if (!isWhoopTokenBody(ctx.body)) {
              throw new Error("WHOOP token body missing");
            }

            const token = await getWhoopTokens({
              type:
                ctx.path === "/refresh-token" ? "refreshToken" : "accessToken",
              accountId: ctx.body.accountId,
              userId: ctx.body.userId,
            });

            if (ctx.path === "/refresh-token") {
              return ctx.json({
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                accountId: ctx.body.accountId,
                providerId: WHOOP_PROVIDER_ID,
                refreshToken: token.refreshToken,
                scope: token.scope,
              });
            }

            return ctx.json({
              accessToken: token.accessToken,
              accessTokenExpiresAt: token.accessTokenExpiresAt,
              scopes: scopes(token.scope),
            });
          }),
        },
      ],
    },
  };
}
