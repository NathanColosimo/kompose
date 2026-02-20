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

// Check every 6 hours to keep background updates lightweight.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface TauriUpdaterContextValue {
  installUpdate: () => Promise<void>;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isReadyToInstall: boolean;
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
  const isReadyToInstallRef = useRef(false);
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const checkForUpdates = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    if (
      isCheckingRef.current ||
      isDownloadingRef.current ||
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
        return;
      }

      updateRef.current = update;

      // Download silently so we can prompt for restart once ready.
      isDownloadingRef.current = true;
      setIsDownloading(true);
      await update.download();
      isReadyToInstallRef.current = true;
      setIsReadyToInstall(true);
    } catch (error) {
      console.warn("Tauri updater check failed.", error);
    } finally {
      isCheckingRef.current = false;
      isDownloadingRef.current = false;
      setIsChecking(false);
      setIsDownloading(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!updateRef.current) {
      return;
    }

    setIsInstalling(true);
    try {
      // Install the downloaded update (Tauri will restart the app).
      await updateRef.current.install();
    } catch (error) {
      console.warn("Tauri updater install failed.", error);
      toast.error("Failed to install update.");
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
    // Run once on launch in production, then on a fixed cadence.
    checkForUpdates().catch((error) => {
      console.warn("Failed to check for updates.", error);
    });
    const intervalId = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkForUpdates]);

  const value = useMemo(
    () => ({
      isReadyToInstall,
      isDownloading,
      isChecking,
      isInstalling,
      installUpdate,
    }),
    [isReadyToInstall, isDownloading, isChecking, isInstalling, installUpdate]
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
      isReadyToInstall: false,
      isDownloading: false,
      isChecking: false,
      isInstalling: false,
      installUpdate: () => {
        console.warn("Not running in Tauri runtime.");
        return Promise.resolve();
      },
    };
  }

  return context;
}
