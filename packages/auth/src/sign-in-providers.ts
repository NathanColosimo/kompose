import { getPluginForProvider } from "@kompose/plugins";
import type { BetterAuthOptions } from "better-auth";
import { getOAuthState } from "better-auth/api";

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

/**
 * Better Auth's `user.validateUserInfo`, asked on the OAuth callback before a
 * provider's account signs in, signs up, or is linked. An account from a
 * plugin that can't sign in (WHOOP) passes only when a signed-in user started
 * the link. See documents/plugins.md.
 */
export const validateSignInProvider: ValidateUserInfo = async ({ source }) => {
  const plugin = getPluginForProvider(source.oauth?.providerId ?? "");
  if (!plugin || plugin.canSignIn) {
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
