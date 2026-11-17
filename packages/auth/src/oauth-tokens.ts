import { Database, DatabaseLive, runtimeMemoMap } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { connectionTable } from "@kompose/db/schema/connection";
import { getPluginForProvider } from "@kompose/plugins";
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
 * Better Auth refreshes a plugin account's tokens itself, with two gaps:
 *
 * - It takes no lock, so two requests can spend the same refresh token. WHOOP
 *   refresh tokens work once, so WHOOP refuses the second request as if the
 *   user had revoked access (better-auth/better-auth#11561).
 * - It drops the provider's error, so a revoked grant looks like any other
 *   failure (better-auth/better-auth#12453).
 *
 * `pluginOAuthTokens` closes both. Before Better Auth answers a request for a
 * token, it refreshes an expiring one under a row lock, with Better Auth's own
 * provider code. Better Auth then finds a valid token and only reads it.
 * Delete this file when both issues are fixed upstream.
 * See documents/plugins.md.
 */

/**
 * Refresh this long before expiry. Better Auth's own refresh starts 5 s before
 * expiry, so it never runs for a token this code keeps valid.
 */
const REFRESH_WINDOW_MS = 30_000;

/** Better Auth's `refreshAccessToken` throws the provider's JSON error body. */
const revokedGrantSchema = z.object({ error: z.literal("invalid_grant") });

/**
 * Every token failure. No caller tells them apart: `getLinkedAccessToken` in
 * `@kompose/api` turns any Better Auth `APIError` into "reconnect it in
 * Settings".
 */
function tokenError(message: string, cause?: unknown): APIError {
  // Better Auth keeps `cause` out of the response body.
  return new APIError("BAD_REQUEST", { cause, message });
}

/** The provider revoked the grant; only signing in again fixes it. */
class ReauthRequiredError extends Schema.TaggedError<ReauthRequiredError>()(
  "ReauthRequiredError",
  {}
) {}

/** The access token expires within the refresh window. */
function isExpiring(account: typeof accountTable.$inferSelect): boolean {
  const expiresAt = account.accessTokenExpiresAt?.getTime();
  // Like Better Auth, never refresh a token whose expiry is unknown.
  return expiresAt !== undefined && expiresAt - Date.now() < REFRESH_WINDOW_MS;
}

interface RefreshRequest {
  /** The local Better Auth account row ID. */
  accountId: string;
  /** Better Auth's context, for its providers and token encryption. */
  authContext: AuthContext;
  userId: string;
}

const refreshExpiring = Effect.fn("OAuthTokens.refreshExpiring")(function* (
  request: RefreshRequest
) {
  const db = yield* Database;
  const accountRow = and(
    eq(accountTable.id, request.accountId),
    eq(accountTable.userId, request.userId)
  );

  // Most calls find a token that is still valid. Check without a transaction
  // or row lock, so concurrent requests don't queue on the row.
  const [current] = yield* db.select().from(accountTable).where(accountRow);
  if (!(current && isExpiring(current))) {
    return;
  }
  const provider = request.authContext.socialProviders.find(
    ({ id }) => id === current.providerId
  );
  if (!(provider?.refreshAccessToken && getPluginForProvider(provider.id))) {
    return;
  }

  const result = yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [account] = yield* tx
        .select()
        .from(accountTable)
        .where(accountRow)
        .for("update");
      // Check again under the lock: a concurrent caller may have refreshed
      // while this one waited. A refresh only ever uses the refresh token read
      // under the lock, because WHOOP's refresh tokens are single-use.
      if (!(account && isExpiring(account))) {
        return;
      }
      const storedRefreshToken = account.refreshToken;
      if (!storedRefreshToken) {
        return yield* Effect.fail(tokenError("Account has no refresh token"));
      }
      const refreshToken = yield* Effect.promise(async () =>
        decryptOAuthToken(storedRefreshToken, request.authContext)
      );

      const tokens = yield* Effect.tryPromise({
        catch: (cause) =>
          revokedGrantSchema.safeParse(cause).success
            ? new ReauthRequiredError()
            : tokenError("Token refresh failed", cause),
        try: async () => provider.refreshAccessToken?.(refreshToken),
      }).pipe(
        // Commit the status with the lock held: a reconnect waiting on this
        // row then reactivates the connection after it, not before.
        Effect.catchTag("ReauthRequiredError", (error) =>
          tx
            .update(connectionTable)
            .set({ status: "needs-reauth" })
            .where(eq(connectionTable.accountId, account.id))
            .pipe(Effect.as(error))
        )
      );
      if (tokens instanceof ReauthRequiredError) {
        return tokens;
      }
      if (!tokens?.accessToken) {
        return yield* Effect.fail(
          tokenError("Token refresh returned no token")
        );
      }

      const encrypt = (token: string) =>
        Effect.promise(
          async () => (await setTokenUtil(token, request.authContext)) ?? token
        );
      // The same columns Better Auth's refresh writes. It leaves `scope`
      // alone too: a refresh can grant fewer scopes than the first consent.
      yield* tx
        .update(accountTable)
        .set({
          accessToken: yield* encrypt(tokens.accessToken),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
          idToken: tokens.idToken ?? account.idToken,
          // Google keeps the refresh token it already issued and sends none.
          refreshToken: yield* encrypt(tokens.refreshToken ?? refreshToken),
          refreshTokenExpiresAt:
            tokens.refreshTokenExpiresAt ?? account.refreshTokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(accountTable.id, account.id));
    })
  );
  if (result instanceof ReauthRequiredError) {
    return yield* Effect.fail(
      tokenError("The provider revoked access; reconnect the account")
    );
  }
});

// Shares the API runtime's Postgres pool through the memo map.
const tokenRuntime = ManagedRuntime.make(DatabaseLive, {
  memoMap: runtimeMemoMap,
});

const accountSelectionSchema = z.object({
  accountId: z.string(),
  userId: z.string().optional(),
});

/**
 * Runs `refreshExpiring` before Better Auth's `/get-access-token` and
 * `/account-info`, the two routes that refresh. `/refresh-token` always
 * refreshes, so it is in `disabledPaths`.
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
            // The route's own rule for who may ask: an HTTP caller needs a
            // session, and only a server call may name a user. Any other
            // request goes on to the route, which rejects it.
            const session = await getSessionFromCtx(ctx, {
              disableCookieCache: isStateful(ctx),
            });
            if (!session && (ctx.request || ctx.headers)) {
              return;
            }
            const userId = session?.user.id ?? selection.data.userId;
            if (!userId) {
              return;
            }
            // Rejects with an `APIError` when the refresh fails.
            await tokenRuntime.runPromise(
              refreshExpiring({
                accountId: selection.data.accountId,
                authContext: ctx.context,
                userId,
              })
            );
          }),
          matcher: (ctx) =>
            ctx.path === "/get-access-token" || ctx.path === "/account-info",
        },
      ],
    },
    id: "plugin-oauth-tokens",
  };
}
