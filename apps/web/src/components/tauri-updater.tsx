"use client";

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

// Check every 6 hours to keep background updates lightweight.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type TauriUpdaterContextValue = {
  isReadyToInstall: boolean;
  isDownloading: boolean;
  isChecking: boolean;
  isInstalling: boolean;
  installUpdate: () => Promise<void>;
};

const TauriUpdaterContext = createContext<TauriUpdaterContextValue | null>(
  null
);

// Detect whether we're running inside the Tauri WebView.
function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function TauriUpdaterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const updateRef = useRef<Update | null>(null);
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const checkForUpdates = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    if (isChecking || isDownloading || isReadyToInstall) {
      return;
    }

    setIsChecking(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (!update) {
        return;
      }

      updateRef.current = update;

      // Download silently so we can prompt for restart once ready.
      setIsDownloading(true);
      await update.download();
      setIsReadyToInstall(true);
    } catch (error) {
      console.warn("Tauri updater check failed.", error);
    } finally {
      setIsChecking(false);
      setIsDownloading(false);
    }
  }, [isChecking, isDownloading, isReadyToInstall]);

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

    // Run once on launch, then on a fixed cadence.
    void checkForUpdates();
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
      installUpdate: async () => {},
    };
  }

  return context;
}
