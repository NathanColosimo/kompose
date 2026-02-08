import type { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Explicitly set baseURL so the auth client works inside Tauri,
// where window.location.origin is "tauri://localhost".
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  plugins: [inferAdditionalFields<typeof auth>()],
});
