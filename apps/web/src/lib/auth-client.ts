import { electronProxyClient } from "@better-auth/electron/proxy";
import type { auth } from "@kompose/auth";
import {
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";
import { env } from "@kompose/env";
import {
  inferAdditionalFields,
  lastLoginMethodClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { desktopFetch, isDesktopRuntime } from "./desktop";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  fetchOptions: {
    ...(isDesktopRuntime() ? { customFetchImpl: desktopFetch } : {}),
  },
  plugins: [
    inferAdditionalFields<typeof auth>(),
    lastLoginMethodClient({ cookieName: "kompose.last_used_login_method" }),
    electronProxyClient({
      clientID: ELECTRON_AUTH_CLIENT_ID,
      cookiePrefix: "kompose",
      protocol: { scheme: ELECTRON_AUTH_SCHEME },
    }),
  ],
});

/** Only forward Better Auth's Electron PKCE parameters from browser sign-in pages. */
export function getElectronAuthQuery() {
  if (typeof window === "undefined" || isDesktopRuntime()) {
    return null;
  }
  const query = new URLSearchParams(window.location.search);
  const client_id = query.get("client_id");
  const state = query.get("state");
  const code_challenge = query.get("code_challenge");
  return client_id === ELECTRON_AUTH_CLIENT_ID && state && code_challenge
    ? { client_id, code_challenge, state }
    : null;
}
