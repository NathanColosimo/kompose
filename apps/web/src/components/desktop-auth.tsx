"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { desktopBridge, isDesktopRuntime } from "@/lib/desktop";

export function DesktopAuth() {
  const queryClient = useQueryClient();
  const { refetch } = authClient.useSession();
  useEffect(() => {
    if (!isDesktopRuntime()) {
      const timer = authClient.ensureElectronRedirect();
      return () => clearInterval(timer);
    }
    document.documentElement.dataset.desktopRuntime = "electron";
    const refresh = () => {
      queryClient.clear();
      refetch();
    };
    const unsubscribe = desktopBridge().onSessionChanged(refresh);
    const authenticated = window.onAuthenticated(refresh);
    const authError = window.onAuthError((error) => toast.error(error.message));
    return () => {
      unsubscribe();
      authenticated();
      authError();
    };
  }, [queryClient, refetch]);
  return null;
}
