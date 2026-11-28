import type { BetterAuthOptions } from "better-auth";
import { getOAuthState } from "better-auth/api";

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
  const oauthState = await getOAuthState();
  if (oauthState?.link) {
    return;
  }
  return {
    error: "provider_cannot_sign_in",
    errorDescription: "Sign in with Google or Apple, then link this account.",
  };
};
