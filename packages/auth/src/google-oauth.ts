import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/**
 * Linking or reconnecting a Google account always shows Google's account
 * chooser and consent screen. The chooser lets the user link an account other
 * than the one they signed in with. Google sends a new refresh token only with
 * consent, which is what Reconnect needs.
 *
 * A server hook, so app versions that are already installed link this way too.
 */
export function googleLinkConsent(): BetterAuthPlugin {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async () => ({
            context: {
              body: { additionalParams: { prompt: "select_account consent" } },
            },
          })),
          matcher: (ctx) =>
            ctx.path === "/link-social" && ctx.body?.provider === "google",
        },
      ],
    },
    id: "google-link-consent",
  };
}
