import { getItemAsync, setItemAsync } from "expo-secure-store";
import { useColorScheme as useSystemColorScheme } from "react-native";
import { Uniwind, useUniwind } from "uniwind";

const THEME_STORAGE_KEY = "kompose-color-scheme";

type ColorSchemePreference = "light" | "dark" | "system";

function isColorSchemePreference(
  value: string | null
): value is ColorSchemePreference {
  return value === "light" || value === "dark" || value === "system";
}

// Apply the scheme safely so a bad config doesn't crash the app.
function applyColorScheme(scheme: ColorSchemePreference): void {
  try {
    Uniwind.setTheme(scheme);
  } catch (error) {
    console.warn("[theme] Failed to apply color scheme", error);
  }
}

/**
 * Apply the preference saved by `setColorScheme`. Call once at app start.
 */
export function restoreColorScheme(): void {
  getItemAsync(THEME_STORAGE_KEY)
    .then((value) => {
      if (isColorSchemePreference(value)) {
        applyColorScheme(value);
      }
    })
    .catch(() => {
      // Ignore restore errors
    });
}

function setColorScheme(scheme: ColorSchemePreference): void {
  applyColorScheme(scheme);
  // Persist the preference so it restores on next launch.
  setItemAsync(THEME_STORAGE_KEY, scheme).catch(console.error);
}

/**
 * Color scheme state derived from the Uniwind theme - no provider needed.
 */
export function useColorScheme() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const systemColorScheme = useSystemColorScheme();

  let userPreference: ColorSchemePreference;
  if (hasAdaptiveThemes) {
    userPreference = "system";
  } else if (theme === "dark") {
    userPreference = "dark";
  } else {
    userPreference = "light";
  }

  // Adaptive mode follows system appearance.
  const activeScheme = hasAdaptiveThemes ? systemColorScheme : theme;
  const colorScheme: "light" | "dark" =
    activeScheme === "dark" ? "dark" : "light";

  return {
    /** Current effective color scheme ("light" or "dark") */
    colorScheme,
    /** Whether dark mode is active */
    isDarkColorScheme: colorScheme === "dark",
    /** Set color scheme with persistence */
    setColorScheme,
    /** Toggle between light and dark */
    toggleColorScheme: () =>
      setColorScheme(colorScheme === "dark" ? "light" : "dark"),
    /** User's preference ("light", "dark", or "system") */
    userPreference,
  };
}
