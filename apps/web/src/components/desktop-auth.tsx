"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth-client";
import { isDesktopRuntime } from "@/lib/desktop";
import { DesktopHandoff } from "./auth/desktop-handoff";

function hasPendingHandoff() {
  // OAuth sets this cookie before redirecting back to the web app.
  return (
    !isDesktopRuntime() && Boolean(authClient.electron.getAuthorizationCode())
  );
}

/**
 * In the browser, return to the desktop app once its sign-in completes, and
 * say so once the app opens. In the app, the main process stores the session
 * and reloads the window itself.
 */
export function DesktopAuth() {
  const [handedOff] = useState(hasPendingHandoff);
  const [stayed, setStayed] = useState(false);

  useMountEffect(() => {
    if (isDesktopRuntime()) {
      return window.onAuthError((error) => toast.error(error.message));
    }
    if (!handedOff) {
      return;
    }
    const timer = authClient.ensureElectronRedirect();
    return () => clearInterval(timer);
  });
  return handedOff && !stayed ? (
    <DesktopHandoff onStay={() => setStayed(true)} />
  ) : null;
}
