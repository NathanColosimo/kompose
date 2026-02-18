import type { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import {
  inferAdditionalFields,
  oneTimeTokenClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import {
  getTauriBearer,
  isTauriRuntime,
  setTauriBearer,
} from "./tauri-desktop";

const tauri = isTauriRuntime();

// Explicitly set baseURL so the auth client works inside Tauri,
// where window.location.origin is "tauri://localhost".
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  plugins: [inferAdditionalFields<typeof auth>(), oneTimeTokenClient()],
  fetchOptions: {
    // In Tauri, authenticate via bearer token instead of cookies.
    // WKWebView ITP blocks cross-origin Set-Cookie, so cookies never work
    // in production. Bearer tokens are sent as Authorization headers which
    // are unaffected by ITP.
    ...(tauri
      ? {
          auth: {
            type: "Bearer" as const,
            token: getTauriBearer,
          },
        }
      : {}),
    onSuccess(context) {
      if (!tauri) {
        return;
      }
      // Capture the bearer token from the server's `set-auth-token` header
      // (provided by Better Auth's bearer plugin) and persist it.
      const authToken = context.response.headers.get("set-auth-token");
      if (authToken) {
        setTauriBearer(authToken);
      }
    },
    onError(context) {
      console.error("[authClient] fetch error:", context.error);
    },
  },
  sessionOptions: {
    // Avoid repetitive get-session calls while the dashboard is active.
    refetchOnWindowFocus: false,
  },
});
