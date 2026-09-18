import { Database, DatabaseLive } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { env } from "@kompose/env";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isStateful,
} from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Schema } from "effect";
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

class WhoopTokenStateError extends Schema.TaggedError<WhoopTokenStateError>()(
  "WhoopTokenStateError",
  {
    accountId: Schema.String,
    message: Schema.String,
  }
) {}

class WhoopTokenRefreshError extends Schema.TaggedError<WhoopTokenRefreshError>()(
  "WhoopTokenRefreshError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    status: Schema.NullOr(Schema.Number),
  }
) {}

/** accountId is the local Better Auth account row ID. */
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

const accountSelectionSchema = z.strictObject({
  accountId: z.string(),
  userId: z.string().optional(),
});

const whoopDatabaseRuntime = ManagedRuntime.make(DatabaseLive);

function scopes(scope: string) {
  return scope.split(",");
}

const refreshWhoopTokens = Effect.fn("WhoopOAuth.refreshTokens")(function* (
  refreshToken: string
) {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;

  if (!clientId) {
    return yield* Effect.fail(
      new WhoopTokenRefreshError({
        cause: new Error("WHOOP_CLIENT_ID is required"),
        message: "WHOOP OAuth client ID is not configured",
        status: null,
      })
    );
  }

  if (!clientSecret) {
    return yield* Effect.fail(
      new WhoopTokenRefreshError({
        cause: new Error("WHOOP_CLIENT_SECRET is required"),
        message: "WHOOP OAuth client secret is not configured",
        status: null,
      })
    );
  }

  const response = yield* Effect.tryPromise({
    catch: (cause) =>
      new WhoopTokenRefreshError({
        cause,
        message: "WHOOP token refresh request failed",
        status: null,
      }),
    try: () =>
      fetch(WHOOP_TOKEN_URL, {
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "offline",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
  });

  if (!response.ok) {
    return yield* Effect.fail(
      new WhoopTokenRefreshError({
        cause: new Error(response.statusText),
        message: `WHOOP token refresh failed: ${response.status}`,
        status: response.status,
      })
    );
  }

  const payload = yield* Effect.tryPromise({
    catch: (cause) =>
      new WhoopTokenRefreshError({
        cause,
        message: "WHOOP token refresh response was not valid JSON",
        status: response.status,
      }),
    try: () => response.json(),
  });
  const parsed = whoopTokenResponseSchema.safeParse(payload);

  if (!parsed.success) {
    return yield* Effect.fail(
      new WhoopTokenRefreshError({
        cause: parsed.error,
        message: "WHOOP token refresh response was invalid",
        status: response.status,
      })
    );
  }

  const token: WhoopTokenResponse = parsed.data;

  return {
    accessToken: token.access_token,
    accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    refreshToken: token.refresh_token,
    scope: token.scope.split(" ").join(","),
  };
});

const getWhoopTokensEffect = Effect.fn("WhoopOAuth.getTokens")(function* (
  request: WhoopTokenRequest
) {
  const db = yield* Database;

  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [account] = yield* tx
        .select()
        .from(accountTable)
        .where(
          and(
            eq(accountTable.id, request.accountId),
            eq(accountTable.providerId, WHOOP_PROVIDER_ID),
            eq(accountTable.userId, request.userId)
          )
        )
        .for("update");

      if (!account) {
        return yield* Effect.fail(
          new WhoopTokenStateError({
            accountId: request.accountId,
            message: "WHOOP account not linked",
          })
        );
      }

      if (!account.accessToken) {
        return yield* Effect.fail(
          new WhoopTokenStateError({
            accountId: request.accountId,
            message: "WHOOP access token missing",
          })
        );
      }

      if (!account.accessTokenExpiresAt) {
        return yield* Effect.fail(
          new WhoopTokenStateError({
            accountId: request.accountId,
            message: "WHOOP token expiry missing",
          })
        );
      }

      if (!account.refreshToken) {
        return yield* Effect.fail(
          new WhoopTokenStateError({
            accountId: request.accountId,
            message: "WHOOP refresh token missing",
          })
        );
      }

      if (!account.scope) {
        return yield* Effect.fail(
          new WhoopTokenStateError({
            accountId: request.accountId,
            message: "WHOOP token scope missing",
          })
        );
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

      const token = yield* refreshWhoopTokens(account.refreshToken);

      yield* tx
        .update(accountTable)
        .set({
          accessToken: token.accessToken,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          refreshToken: token.refreshToken,
          // A refresh response can contain fewer scopes than the original grant.
          // Preserve the stored grant, matching Better Auth 1.7's refresh behavior.
          scope: account.scope,
          updatedAt: new Date(),
        })
        .where(eq(accountTable.id, account.id));

      return { ...token, scope: account.scope };
    })
  );
});

export function getWhoopTokens(request: WhoopTokenRequest) {
  return whoopDatabaseRuntime.runPromise(getWhoopTokensEffect(request));
}

export function whoopOAuthTokens(): BetterAuthPlugin {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const selection = accountSelectionSchema.safeParse(
              ctx.path === "/account-info" ? ctx.query : ctx.body
            );
            if (!selection.success) {
              return;
            }

            // Match Better Auth's token-route authorization: HTTP callers must
            // have a current session; only trusted server calls may name a user.
            const session = await getSessionFromCtx(ctx, {
              disableCookieCache: isStateful(ctx),
            });
            if (!session && (ctx.request || ctx.headers)) {
              throw new APIError("UNAUTHORIZED");
            }
            const userId = session?.user.id ?? selection.data.userId;
            if (!userId) {
              throw new APIError("BAD_REQUEST", {
                code: "USER_ID_OR_SESSION_REQUIRED",
                message: "Either userId or session is required",
              });
            }

            const account = await ctx.context.adapter.findOne<{
              providerId: string;
            }>({
              model: "account",
              select: ["providerId"],
              where: [
                { field: "id", value: selection.data.accountId },
                { field: "userId", value: userId },
              ],
            });
            if (account?.providerId !== WHOOP_PROVIDER_ID) {
              return;
            }

            const token = await getWhoopTokens({
              accountId: selection.data.accountId,
              type:
                ctx.path === "/refresh-token" ? "refreshToken" : "accessToken",
              userId,
            });

            // accountInfo refreshes tokens internally without invoking the token
            // endpoint. Refresh under our row lock first, then let it fetch the
            // profile using the newly persisted token.
            if (ctx.path === "/account-info") {
              return;
            }

            if (ctx.path === "/refresh-token") {
              return ctx.json({
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                accountId: selection.data.accountId,
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
          matcher: (ctx) =>
            ctx.path === "/get-access-token" ||
            ctx.path === "/refresh-token" ||
            ctx.path === "/account-info",
        },
      ],
    },
    id: "whoop-oauth-tokens",
  };
}
