"use client";

import { isProductionDeployment } from "@kompose/env";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { isTauriRuntime } from "@/lib/tauri-desktop";

// Re-check often enough that desktop users see updates during the workday.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

type TauriUpdaterStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "installing";

interface TauriUpdaterContextValue {
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isReadyToInstall: boolean;
  status: TauriUpdaterStatus;
}

const TauriUpdaterContext = createContext<TauriUpdaterContextValue | null>(
  null
);

export function TauriUpdaterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const updateRef = useRef<Update | null>(null);
  const isCheckingRef = useRef(false);
  const isDownloadingRef = useRef(false);
  const isInstallingRef = useRef(false);
  const isReadyToInstallRef = useRef(false);
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const runUpdateCheck = useCallback(
    async ({ silent }: { silent: boolean }) => {
      if (!isTauriRuntime()) {
        return;
      }

      if (!isProductionDeployment) {
        return;
      }

      if (
        isCheckingRef.current ||
        isDownloadingRef.current ||
        isInstallingRef.current ||
        isReadyToInstallRef.current
      ) {
        return;
      }

      isCheckingRef.current = true;
      setIsChecking(true);
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();

        if (!update) {
          if (!silent) {
            toast.success("Kompose is up to date.");
          }
          return;
        }

        updateRef.current = update;

        // Keep auto and manual flows aligned: download in the background,
        // then expose a restart affordance once the bundle is ready.
        isDownloadingRef.current = true;
        setIsDownloading(true);
        await update.download();
        isReadyToInstallRef.current = true;
        setIsReadyToInstall(true);

        if (!silent) {
          toast.success("Update ready to install.");
        }
      } catch (error) {
        console.warn("Tauri updater check failed.", error);
        if (!silent) {
          toast.error("Failed to check for updates.");
        }
      } finally {
        isCheckingRef.current = false;
        isDownloadingRef.current = false;
        setIsChecking(false);
        setIsDownloading(false);
      }
    },
    []
  );

  const checkForUpdates = useCallback(async () => {
    await runUpdateCheck({ silent: false });
  }, [runUpdateCheck]);

  const installUpdate = useCallback(async () => {
    if (!updateRef.current || isInstallingRef.current) {
      return;
    }

    isInstallingRef.current = true;
    setIsInstalling(true);
    let installed = false;
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");

      // Tauri installs the downloaded bundle first, then we explicitly
      // relaunch the desktop process so the new version boots immediately.
      await updateRef.current.install();
      installed = true;
      await relaunch();
    } catch (error) {
      console.warn("Tauri updater install failed.", error);
      toast.error(
        installed
          ? "Update installed. Please quit and reopen Kompose."
          : "Failed to install update."
      );
      isInstallingRef.current = false;
      setIsInstalling(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    if (!isProductionDeployment) {
      return;
    }

    // Skip updater checks in dev builds to avoid noisy network error logs.
    // Re-check on launch, while the app stays open, and whenever it regains focus.
    const triggerSilentCheck = () => {
      runUpdateCheck({ silent: true }).catch((error) => {
        console.warn("Failed to check for updates.", error);
      });
    };

    const handleWindowFocus = () => {
      triggerSilentCheck();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerSilentCheck();
      }
    };

    triggerSilentCheck();
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(
      triggerSilentCheck,
      UPDATE_CHECK_INTERVAL_MS
    );

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [runUpdateCheck]);

  const status = useMemo<TauriUpdaterStatus>(() => {
    if (isInstalling) {
      return "installing";
    }
    if (isReadyToInstall) {
      return "ready";
    }
    if (isDownloading) {
      return "downloading";
    }
    if (isChecking) {
      return "checking";
    }
    return "idle";
  }, [isChecking, isDownloading, isInstalling, isReadyToInstall]);

  const value = useMemo(
    () => ({
      checkForUpdates,
      isReadyToInstall,
      isDownloading,
      isChecking,
      isInstalling,
      installUpdate,
      status,
    }),
    [
      checkForUpdates,
      isReadyToInstall,
      isDownloading,
      isChecking,
      isInstalling,
      installUpdate,
      status,
    ]
  );

  return (
    <TauriUpdaterContext.Provider value={value}>
      {children}
    </TauriUpdaterContext.Provider>
  );
}

export function useTauriUpdater() {
  const context = useContext(TauriUpdaterContext);

  if (!context) {
    return {
      checkForUpdates: () => {
        console.warn("Not running in Tauri runtime.");
        return Promise.resolve();
      },
      isReadyToInstall: false,
      isDownloading: false,
      isChecking: false,
      isInstalling: false,
      installUpdate: () => {
        console.warn("Not running in Tauri runtime.");
        return Promise.resolve();
      },
      status: "idle" as TauriUpdaterStatus,
    };
  }

  return context;
}
