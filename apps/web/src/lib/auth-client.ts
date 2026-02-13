import type { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import {
  inferAdditionalFields,
  oneTimeTokenClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Explicitly set baseURL so the auth client works inside Tauri,
// where window.location.origin is "tauri://localhost".
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_WEB_URL,
  plugins: [inferAdditionalFields<typeof auth>(), oneTimeTokenClient()],
  sessionOptions: {
    // Avoid repetitive get-session calls while the dashboard is active.
    refetchOnWindowFocus: false,
  },
});
