import { Database, DatabaseLive, runtimeMemoMap } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { connectionTable } from "@kompose/db/schema/connection";
import { env } from "@kompose/env";
import type { OAuthProvider } from "@kompose/plugins";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isStateful,
} from "better-auth/api";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { and, eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Schema } from "effect";
import { z } from "zod";

/**
 * Token refresh for every OAuth plugin. Better Auth's own refresh has no lock
 * (WHOOP rotates refresh tokens, so two concurrent refreshes log the user out)
 * and hides the provider's error, so a revoked grant looks like any failure.
 * This hook refreshes under a row lock and marks the plugin's connection
 * `needs-reauth` when the provider answers `invalid_grant`.
 * See documents/plugins.md.
 */

interface RefreshConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Extra form fields; WHOOP only returns a new refresh token for `offline`. */
  params?: Record<string, string>;
  tokenUrl: string;
}

const refreshConfigs: Record<OAuthProvider, RefreshConfig> = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  whoop: {
    clientId: env.WHOOP_CLIENT_ID,
    clientSecret: env.WHOOP_CLIENT_SECRET,
    params: { scope: "offline" },
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
  },
};

function isPluginProvider(id: string | undefined): id is OAuthProvider {
  return id !== undefined && Object.hasOwn(refreshConfigs, id);
}

/** Refresh this long before expiry so callers never get a token about to lapse. */
const REFRESH_WINDOW_MS = 30_000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  // Google keeps the refresh token it already issued and omits it here.
  refresh_token: z.string().optional(),
});

/**
 * Every token failure. No caller tells them apart: `getLinkedAccessToken` in
 * `@kompose/api` turns any Better Auth `APIError` into "reconnect it in
 * Settings", and the provider's answer goes in the message.
 */
function tokenError(message: string): APIError {
  return new APIError("BAD_REQUEST", { message });
}

/** The provider revoked the grant; only signing in again fixes it. */
class ReauthRequiredError extends Schema.TaggedError<ReauthRequiredError>()(
  "ReauthRequiredError",
  { message: Schema.String }
) {}

const refreshTokens = Effect.fn("OAuthTokens.refresh")(function* (
  config: RefreshConfig,
  refreshToken: string
) {
  const { clientId, clientSecret } = config;
  if (!(clientId && clientSecret)) {
    return yield* Effect.fail(tokenError("OAuth client is not configured"));
  }

  const response = yield* Effect.tryPromise({
    catch: () => tokenError("Token request failed"),
    try: () =>
      fetch(config.tokenUrl, {
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          ...config.params,
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
  });
  const body: unknown = yield* Effect.promise(() =>
    response.json().catch(() => null)
  );

  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    if (error.success && error.data.error === "invalid_grant") {
      return yield* new ReauthRequiredError({
        message: "The provider revoked access; reconnect the account",
      });
    }
    return yield* Effect.fail(
      tokenError(`Token refresh failed: ${response.status}`)
    );
  }

  const token = tokenResponseSchema.safeParse(body);
  if (!token.success) {
    return yield* Effect.fail(tokenError("Token refresh response was invalid"));
  }
  return {
    accessToken: token.data.access_token,
    accessTokenExpiresAt: new Date(Date.now() + token.data.expires_in * 1000),
    refreshToken: token.data.refresh_token ?? refreshToken,
  };
});

interface TokenRequest {
  /** The local Better Auth account row ID. */
  accountId: string;
  /** Better Auth's context, for its token encryption. */
  authContext: AuthContext;
  provider: OAuthProvider;
  /** `refresh` always refreshes; `access` reuses a token that isn't expiring. */
  type: "access" | "refresh";
  userId: string;
}

type AccountRow = typeof accountTable.$inferSelect;

/** The stored access token is present and more than 30 s from expiry. */
function hasFreshAccessToken(
  account: AccountRow
): account is AccountRow & { accessToken: string } {
  const expiresAt = account.accessTokenExpiresAt?.getTime() ?? 0;
  return (
    account.accessToken !== null && expiresAt - Date.now() > REFRESH_WINDOW_MS
  );
}

const getTokens = Effect.fn("OAuthTokens.get")(function* (
  request: TokenRequest
) {
  const db = yield* Database;
  const decrypt = (token: string) =>
    Effect.promise(async () => decryptOAuthToken(token, request.authContext));
  const encrypt = (token: string) =>
    Effect.promise(
      async () => (await setTokenUtil(token, request.authContext)) ?? token
    );

  const accountRow = and(
    eq(accountTable.id, request.accountId),
    eq(accountTable.userId, request.userId)
  );

  // Most calls find a token that is still valid. Read it without a
  // transaction or row lock, so concurrent requests don't queue on the row.
  // Refreshing, or encrypting tokens stored before encryption, takes the lock.
  if (request.type === "access") {
    const [account] = yield* db.select().from(accountTable).where(accountRow);
    if (account?.refreshToken && hasFreshAccessToken(account)) {
      const accessToken = yield* decrypt(account.accessToken);
      const refreshToken = yield* decrypt(account.refreshToken);
      if (
        accessToken !== account.accessToken &&
        refreshToken !== account.refreshToken
      ) {
        return {
          accessToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
          refreshToken,
          scope: account.scope,
        };
      }
    }
  }

  return yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const [account] = yield* tx
          .select()
          .from(accountTable)
          .where(accountRow)
          .for("update");
        if (!account?.refreshToken) {
          return yield* Effect.fail(
            tokenError("Account not found or has no refresh token")
          );
        }

        const refreshToken = yield* decrypt(account.refreshToken);
        // Check again under the lock: a concurrent caller may have refreshed
        // while this one waited, so use its token instead of refreshing again.
        // A refresh only ever uses the refresh token read under the lock,
        // because WHOOP's refresh tokens are single-use.
        if (request.type === "access" && hasFreshAccessToken(account)) {
          const accessToken = yield* decrypt(account.accessToken);
          // Tokens stored before `encryptOAuthTokens` decrypt to themselves;
          // encrypt them now. A refresh (below) always writes them encrypted.
          if (
            accessToken === account.accessToken ||
            refreshToken === account.refreshToken
          ) {
            yield* tx
              .update(accountTable)
              .set({
                accessToken: yield* encrypt(accessToken),
                refreshToken: yield* encrypt(refreshToken),
              })
              .where(eq(accountTable.id, account.id));
          }
          return {
            accessToken,
            accessTokenExpiresAt: account.accessTokenExpiresAt,
            refreshToken,
            scope: account.scope,
          };
        }

        const token = yield* refreshTokens(
          refreshConfigs[request.provider],
          refreshToken
        );
        yield* tx
          .update(accountTable)
          .set({
            accessToken: yield* encrypt(token.accessToken),
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            refreshToken: yield* encrypt(token.refreshToken),
            updatedAt: new Date(),
          })
          .where(eq(accountTable.id, account.id));
        // A refresh can grant fewer scopes than the original consent; keep
        // the stored grant, as Better Auth does.
        return { ...token, scope: account.scope };
      })
    )
    .pipe(
      // After the rollback, so the status change sticks.
      Effect.catchTag("ReauthRequiredError", (error) =>
        db
          .update(connectionTable)
          .set({ status: "needs-reauth" })
          .where(eq(connectionTable.accountId, request.accountId))
          .pipe(Effect.andThen(Effect.fail(tokenError(error.message))))
      )
    );
});

// Shares the API runtime's Postgres pool through the memo map.
const tokenRuntime = ManagedRuntime.make(DatabaseLive, {
  memoMap: runtimeMemoMap,
});

/**
 * The account's tokens, refreshed under a row lock when needed. Rejects with
 * a Better Auth `APIError`.
 */
export function getPluginTokens(request: TokenRequest) {
  return tokenRuntime.runPromise(getTokens(request));
}

const accountSelectionSchema = z.strictObject({
  accountId: z.string(),
  userId: z.string().optional(),
});

/**
 * Answers Better Auth's `/get-access-token` and `/refresh-token` for plugin
 * accounts, and refreshes before `/account-info` (which would otherwise
 * refresh on its own, without the lock).
 */
export function pluginOAuthTokens(): BetterAuthPlugin {
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
            const provider = account?.providerId;
            if (!isPluginProvider(provider)) {
              return;
            }

            const token = await getPluginTokens({
              accountId: selection.data.accountId,
              authContext: ctx.context,
              provider,
              type: ctx.path === "/refresh-token" ? "refresh" : "access",
              userId,
            });

            if (ctx.path === "/account-info") {
              return;
            }
            if (ctx.path === "/refresh-token") {
              return ctx.json({
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                accountId: selection.data.accountId,
                providerId: provider,
                refreshToken: token.refreshToken,
                scope: token.scope,
              });
            }
            return ctx.json({
              accessToken: token.accessToken,
              accessTokenExpiresAt: token.accessTokenExpiresAt,
              scopes: token.scope?.split(",") ?? [],
            });
          }),
          matcher: (ctx) =>
            ctx.path === "/get-access-token" ||
            ctx.path === "/refresh-token" ||
            ctx.path === "/account-info",
        },
      ],
    },
    id: "plugin-oauth-tokens",
  };
}
