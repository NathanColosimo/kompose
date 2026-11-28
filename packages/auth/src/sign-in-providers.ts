import { getPluginForProvider } from "@kompose/plugins";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";

/**
 * Whether an account from this provider signs in to Kompose. An account from
 * a plugin that says it can't (WHOOP) only connects that plugin.
 * See documents/plugins.md.
 */
function canSignIn(providerId: string): boolean {
  return getPluginForProvider(providerId)?.canSignIn ?? true;
}

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

/**
 * Better Auth's `user.validateUserInfo`, asked on the OAuth callback before a
 * provider's account signs in, signs up, or is linked. An account that can't
 * sign in passes only when a signed-in user started the link.
 */
export const validateSignInProvider: ValidateUserInfo = async ({ source }) => {
  if (canSignIn(source.oauth?.providerId ?? "")) {
    return;
  }
  const oauthState = await getOAuthState();
  if (oauthState?.link) {
    return;
  }
  return {
    error: "provider_cannot_sign_in",
    errorDescription: "Sign in with Google or Apple, then link this account.",
  };
};

/**
 * Better Auth's `/unlink-account` refuses to unlink a user's last account.
 * An account that can't sign in doesn't count: this also refuses to unlink
 * the last account the user can sign in with.
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
              canSignIn(account.providerId)
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
