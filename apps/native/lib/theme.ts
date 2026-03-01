import {
  DarkTheme,
  DefaultTheme,
  type Theme as NavigationTheme,
} from "@react-navigation/native";

/**
 * Theme tokens for React Navigation.
 *
 * These values must match the CSS variables in global.css.
 * React Native requires comma-separated HSL format: hsl(h, s%, l%)
 */
export const THEME = {
  light: {
    background: "hsl(42, 28%, 88%)",
    foreground: "hsl(0, 0%, 12%)",
    card: "hsl(41, 42%, 93%)",
    cardForeground: "hsl(0, 0%, 12%)",
    popover: "hsl(41, 42%, 93%)",
    popoverForeground: "hsl(0, 0%, 12%)",
    primary: "hsl(0, 0%, 18%)",
    primaryForeground: "hsl(52, 23%, 87%)",
    secondary: "hsl(42, 20%, 81%)",
    secondaryForeground: "hsl(0, 0%, 18%)",
    muted: "hsl(42, 19%, 77%)",
    mutedForeground: "hsl(40, 7%, 35%)",
    accent: "hsl(52, 23%, 87%)",
    accentForeground: "hsl(0, 0%, 18%)",
    destructive: "hsl(0, 72%, 51%)",
    destructiveForeground: "hsl(0, 0%, 100%)",
    border: "hsl(42, 20%, 78%)",
    input: "hsl(42, 20%, 78%)",
    ring: "hsl(0, 0%, 18%)",
  },
  dark: {
    background: "hsl(0, 0%, 8%)",
    foreground: "hsl(39, 23%, 88%)",
    card: "hsl(0, 0%, 11%)",
    cardForeground: "hsl(39, 23%, 88%)",
    popover: "hsl(0, 0%, 11%)",
    popoverForeground: "hsl(39, 23%, 88%)",
    primary: "hsl(53, 16%, 79%)",
    primaryForeground: "hsl(0, 0%, 21%)",
    secondary: "hsl(0, 0%, 13%)",
    secondaryForeground: "hsl(53, 16%, 79%)",
    muted: "hsl(0, 0%, 16%)",
    mutedForeground: "hsl(38, 5%, 54%)",
    accent: "hsl(0, 0%, 21%)",
    accentForeground: "hsl(53, 16%, 79%)",
    destructive: "hsl(0, 84%, 60%)",
    destructiveForeground: "hsl(0, 0%, 100%)",
    border: "hsl(0, 0%, 17%)",
    input: "hsl(0, 0%, 17%)",
    ring: "hsl(53, 16%, 79%)",
  },
};

export const NAV_THEME: Record<"light" | "dark", NavigationTheme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
