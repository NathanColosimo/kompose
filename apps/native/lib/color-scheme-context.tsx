import { getItemAsync, setItemAsync } from "expo-secure-store";
import {
  colorScheme,
  useColorScheme as useNativeWindColorScheme,
} from "nativewind";
import { useCallback, useEffect, useRef, useState } from "react";

const THEME_STORAGE_KEY = "kompose-color-scheme";

type ColorSchemePreference = "light" | "dark" | "system";

/**
 * Set and persist color scheme preference.
 * Can be called outside of React components.
 */
function persistColorScheme(scheme: ColorSchemePreference) {
  colorScheme.set(scheme);
  setItemAsync(THEME_STORAGE_KEY, scheme).catch(console.error);
}

/**
 * Hook to access color scheme state with persistence.
 * Uses NativeWind's useColorScheme internally - no provider needed.
 */
export function useColorScheme() {
  const nativewind = useNativeWindColorScheme();
  const hasRestored = useRef(false);
  // Track user preference for UI (since NativeWind doesn't expose this)
  const [userPreference, setUserPreference] =
    useState<ColorSchemePreference>("system");

  // Restore saved preference on first mount
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    getItemAsync(THEME_STORAGE_KEY)
      .then((value) => {
        if (value === "light" || value === "dark" || value === "system") {
          setUserPreference(value);
          colorScheme.set(value);
        }
      })
      .catch(() => {
        // Ignore restore errors
      });
  }, []);

  const setColorScheme = useCallback((scheme: ColorSchemePreference) => {
    setUserPreference(scheme);
    persistColorScheme(scheme);
  }, []);

  const toggleColorScheme = useCallback(() => {
    const next = nativewind.colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [nativewind.colorScheme, setColorScheme]);

  return {
    /** Current effective color scheme ("light" or "dark") */
    colorScheme: nativewind.colorScheme ?? "light",
    /** Whether dark mode is active */
    isDarkColorScheme: nativewind.colorScheme === "dark",
    /** User's preference ("light", "dark", or "system") */
    userPreference,
    /** Set color scheme with persistence */
    setColorScheme,
    /** Toggle between light and dark */
    toggleColorScheme,
  };
}
