"use client";

import type { DesktopUpdateState } from "@kompose/desktop";
import { createContext, use, useEffect, useState } from "react";
import { toast } from "sonner";
import { desktopBridge, isDesktopRuntime } from "@/lib/desktop";

const DesktopUpdaterContext = createContext<DesktopUpdateState>({
  status: "idle",
});
export function DesktopUpdaterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<DesktopUpdateState>({ status: "idle" });
  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    let disposed = false;
    desktopBridge()
      .getUpdateState()
      .then((value) => {
        if (!disposed) {
          setState(value);
        }
      });
    const unsubscribe = desktopBridge().onUpdateState(setState);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return (
    <DesktopUpdaterContext value={state}>{children}</DesktopUpdaterContext>
  );
}
export function useDesktopUpdater() {
  const state = use(DesktopUpdaterContext);
  return {
    async checkForUpdates() {
      try {
        await desktopBridge().checkForUpdates();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Update check failed."
        );
      }
    },
    async installUpdate() {
      try {
        await desktopBridge().installUpdate();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Update installation failed."
        );
      }
    },
    isChecking: state.status === "checking",
    isDownloading: state.status === "downloading",
    isInstalling: state.status === "installing",
    isReadyToInstall: state.status === "ready",
    status: state.status,
  };
}
