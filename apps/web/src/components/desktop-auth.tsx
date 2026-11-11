"use client";

import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";

/**
 * In the browser, return to the desktop app once its sign-in completes. In the
 * app, the main process stores the session and reloads the window itself.
 */
export function DesktopAuth() {
  useMountEffect(() => {
    if (isDesktopRuntime()) {
      return window.onAuthError((error) => toast.error(error.message));
    }
    // OAuth sets this cookie before redirecting back to the web app.
    if (!authClient.electron.getAuthorizationCode()) {
      return;
    }
    const timer = authClient.ensureElectronRedirect();
    return () => clearInterval(timer);
  });
  return null;
}
