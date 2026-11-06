import { electronProxyClient } from "@better-auth/electron/proxy";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import type { auth } from "@kompose/auth";
import { clientEnv } from "@kompose/env/client";
import {
  inferAdditionalFields,
  lastLoginMethodClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { isDesktopRuntime } from "./desktop";
import {
  electronAuthProxyOptions,
  parseElectronAuthQuery,
} from "./desktop-auth-handoff";

export const authClient = createAuthClient({
  baseURL: clientEnv.NEXT_PUBLIC_WEB_URL,
  plugins: [
    inferAdditionalFields<typeof auth>(),
    lastLoginMethodClient({ cookieName: "kompose.last_used_login_method" }),
    // Sends the signed OAuth query from /login and /oauth/consent during MCP authorization.
    oauthProviderClient(),
    electronProxyClient(electronAuthProxyOptions),
  ],
});

/** Only forward Better Auth's Electron PKCE parameters from browser sign-in pages. */
export function getElectronAuthQuery() {
  if (typeof window === "undefined" || isDesktopRuntime()) {
    return null;
  }
  return parseElectronAuthQuery(window.location.search);
}

export function extractAuthErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }
  const error = result.error as {
    message?: string;
    statusText?: string;
  } | null;
  return error?.message || error?.statusText || null;
}
