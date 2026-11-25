import { getPluginForProvider } from "@kompose/plugins";
import type {
  Account,
  BetterAuthOptions,
  BetterAuthPlugin,
  GenericEndpointContext,
} from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";

/**
 * A user signs in to Kompose with these providers. An account from any other
 * provider (WHOOP) only connects a plugin. See documents/plugins.md.
 */
const signInProviders: readonly string[] = ["apple", "google"];

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

/**
 * Better Auth's `user.validateUserInfo`, asked on the OAuth callback before a
 * provider's account signs in, signs up, or is linked. An account that can't
 * sign in passes only when a signed-in user started the link.
 */
export const validateSignInProvider: ValidateUserInfo = async ({ source }) => {
  if (
    source.method !== "oauth" ||
    signInProviders.includes(source.oauth?.providerId ?? "")
  ) {
    return;
  }
  const state = await getOAuthState();
  if (state?.link) {
    return;
  }
  return {
    error: "provider_cannot_sign_in",
    errorDescription: "Sign in with Google or Apple, then link this account.",
  };
};

/**
 * Better Auth's `account.create.before`. A plugin that allows one account
 * (WHOOP) keeps the user's first: returning false fails the link with
 * `unable_to_link_account`. Reconnect updates the account it already has, so
 * it never gets here.
 */
export async function refuseExtraAccount(
  account: Account,
  context: GenericEndpointContext | null
): Promise<boolean> {
  const plugin = getPluginForProvider(account.providerId);
  // Better Auth only passes no context to code that calls its adapter directly.
  if (!(plugin && context) || plugin.multipleAccounts) {
    return true;
  }
  const accounts = await context.context.internalAdapter.findAccounts(
    account.userId
  );
  return !accounts.some((other) => other.providerId === account.providerId);
}

/**
 * Better Auth's `/unlink-account` refuses to unlink a user's last account.
 * A plugin-only account doesn't count: this also refuses to unlink the last
 * account the user can sign in with.
 */
export function keepSignInAccount(): BetterAuthPlugin {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            // The route rejects a request with no session.
            const session = await getSessionFromCtx(ctx);
            if (!session) {
              return;
            }
            const accounts = await ctx.context.internalAdapter.findAccounts(
              session.user.id
            );
            const signInAccounts = accounts.filter((account) =>
              signInProviders.includes(account.providerId)
            );
            if (
              signInAccounts.length === 1 &&
              signInAccounts[0]?.id === ctx.body?.accountId
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "FAILED_TO_UNLINK_LAST_SIGN_IN_ACCOUNT",
                message:
                  "This is the only account you can sign in with. Link another Google or Apple account before unlinking it.",
              });
            }
          }),
          matcher: (ctx) => ctx.path === "/unlink-account",
        },
      ],
    },
    id: "keep-sign-in-account",
  };
}
