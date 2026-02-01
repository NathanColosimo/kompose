import { getItemAsync, setItemAsync } from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

const THEME_STORAGE_KEY = "kompose-color-scheme";

type ColorScheme = "light" | "dark" | "system";

interface ColorSchemeContextValue {
  colorScheme: "light" | "dark";
  isDarkColorScheme: boolean;
  userPreference: ColorScheme;
  isLoaded: boolean;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleColorScheme: () => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

/**
 * Provider that manages color scheme state at the app root.
 * Must wrap the entire app for theme switching to work.
 */
export function ColorSchemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const rawSystemColorScheme = useRNColorScheme();
  // Normalize system color scheme to always be "light" or "dark"
  const systemColorScheme: "light" | "dark" =
    rawSystemColorScheme === "dark" ? "dark" : "light";

  const [userPreference, setUserPreference] = useState<ColorScheme>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    getItemAsync(THEME_STORAGE_KEY)
      .then((value) => {
        if (value === "light" || value === "dark" || value === "system") {
          setUserPreference(value);
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, []);

  // Compute effective color scheme (always "light" or "dark")
  const effectiveColorScheme: "light" | "dark" =
    userPreference === "system" ? systemColorScheme : userPreference;

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setUserPreference(scheme);
    setItemAsync(THEME_STORAGE_KEY, scheme).catch(console.error);
  }, []);

  const toggleColorScheme = useCallback(() => {
    const next = effectiveColorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [effectiveColorScheme, setColorScheme]);

  const value: ColorSchemeContextValue = {
    colorScheme: effectiveColorScheme,
    isDarkColorScheme: effectiveColorScheme === "dark",
    userPreference,
    isLoaded,
    setColorScheme,
    toggleColorScheme,
  };

  return (
    <ColorSchemeContext.Provider value={value}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

/**
 * Hook to access color scheme state.
 * Must be used within a ColorSchemeProvider.
 */
export function useColorScheme(): ColorSchemeContextValue {
  const context = useContext(ColorSchemeContext);
  if (!context) {
    throw new Error("useColorScheme must be used within a ColorSchemeProvider");
  }
  return context;
}
