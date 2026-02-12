import { getItemAsync, setItemAsync } from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ColorSchemeName,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import { Uniwind, useUniwind } from "uniwind";

const THEME_STORAGE_KEY = "kompose-color-scheme";

type ColorSchemePreference = "light" | "dark" | "system";

function resolveEffectiveColorScheme(
  theme: string,
  hasAdaptiveThemes: boolean,
  systemColorScheme: ColorSchemeName
): "light" | "dark" {
  // Adaptive mode follows system appearance.
  if (hasAdaptiveThemes || theme === "system") {
    return systemColorScheme === "dark" ? "dark" : "light";
  }

  return theme === "dark" ? "dark" : "light";
}

/**
 * Hook to access color scheme state with persistence.
 * Uses Uniwind theme APIs internally - no provider needed.
 */
export function useColorScheme() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const systemColorScheme = useSystemColorScheme();
  const hasRestored = useRef(false);
  // Track user preference for the settings UI and persistence.
  const [userPreference, setUserPreference] =
    useState<ColorSchemePreference>("system");
  const colorScheme = useMemo(
    () =>
      resolveEffectiveColorScheme(theme, hasAdaptiveThemes, systemColorScheme),
    [hasAdaptiveThemes, systemColorScheme, theme]
  );

  // Apply the scheme safely so a bad config doesn't crash the app.
  const applyColorScheme = useCallback((scheme: ColorSchemePreference) => {
    try {
      Uniwind.setTheme(scheme);
    } catch (error) {
      console.warn("[theme] Failed to apply color scheme", error);
    }
  }, []);

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

  // Keep UI state in sync if theme changes outside this hook.
  useEffect(() => {
    const nextPreference: ColorSchemePreference = hasAdaptiveThemes
      ? "system"
      : theme === "dark"
        ? "dark"
        : "light";
    setUserPreference((current) =>
      current === nextPreference ? current : nextPreference
    );
  }, [hasAdaptiveThemes, theme]);

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
    const next = colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [colorScheme, setColorScheme]);

  return {
    /** Current effective color scheme ("light" or "dark") */
    colorScheme,
    /** Whether dark mode is active */
    isDarkColorScheme: colorScheme === "dark",
    /** User's preference ("light", "dark", or "system") */
    userPreference,
    /** Set color scheme with persistence */
    setColorScheme,
    /** Toggle between light and dark */
    toggleColorScheme,
  };
}
