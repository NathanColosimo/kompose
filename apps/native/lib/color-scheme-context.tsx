import { getItemAsync, setItemAsync } from "expo-secure-store";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { useCallback, useEffect, useRef, useState } from "react";

const THEME_STORAGE_KEY = "kompose-color-scheme";

type ColorSchemePreference = "light" | "dark" | "system";

/**
 * Hook to access color scheme state with persistence.
 * Uses NativeWind's useColorScheme internally - no provider needed.
 */
export function useColorScheme() {
  const {
    colorScheme: nativeColorScheme,
    setColorScheme: setNativeColorScheme,
  } = useNativeWindColorScheme();
  const hasRestored = useRef(false);
  // Track user preference for UI (since NativeWind doesn't expose this)
  const [userPreference, setUserPreference] =
    useState<ColorSchemePreference>("system");

  // Apply the scheme safely so a bad config doesn't crash the app.
  const applyColorScheme = useCallback(
    (scheme: ColorSchemePreference) => {
      try {
        setNativeColorScheme(scheme);
      } catch (error) {
        console.warn("[theme] Failed to apply color scheme", error);
      }
    },
    [setNativeColorScheme]
  );

  // Restore saved preference on first mount
  useEffect(() => {
    if (hasRestored.current) {
      return;
    }
    hasRestored.current = true;
    let isCancelled = false;

    getItemAsync(THEME_STORAGE_KEY)
      .then((value) => {
        if (isCancelled) {
          return;
        }
        if (value === "light" || value === "dark" || value === "system") {
          setUserPreference(value);
          applyColorScheme(value);
        }
      })
      .catch(() => {
        // Ignore restore errors
      });

    return () => {
      isCancelled = true;
    };
  }, [applyColorScheme]);

  const setColorScheme = useCallback(
    (scheme: ColorSchemePreference) => {
      setUserPreference(scheme);
      applyColorScheme(scheme);
      // Persist the preference so it restores on next launch.
      setItemAsync(THEME_STORAGE_KEY, scheme).catch(console.error);
    },
    [applyColorScheme]
  );

  const toggleColorScheme = useCallback(() => {
    const next = nativeColorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [nativeColorScheme, setColorScheme]);

  return {
    /** Current effective color scheme ("light" or "dark") */
    colorScheme: nativeColorScheme ?? "light",
    /** Whether dark mode is active */
    isDarkColorScheme: nativeColorScheme === "dark",
    /** User's preference ("light", "dark", or "system") */
    userPreference,
    /** Set color scheme with persistence */
    setColorScheme,
    /** Toggle between light and dark */
    toggleColorScheme,
  };
}
