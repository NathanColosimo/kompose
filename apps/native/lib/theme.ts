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
    background: "hsl(0, 0%, 100%)",
    foreground: "hsl(0, 0%, 4%)",
    card: "hsl(0, 0%, 100%)",
    cardForeground: "hsl(0, 0%, 4%)",
    popover: "hsl(0, 0%, 100%)",
    popoverForeground: "hsl(0, 0%, 4%)",
    primary: "hsl(0, 0%, 45%)",
    primaryForeground: "hsl(0, 0%, 98%)",
    secondary: "hsl(0, 0%, 96%)",
    secondaryForeground: "hsl(0, 0%, 9%)",
    muted: "hsl(0, 0%, 96%)",
    mutedForeground: "hsl(0, 0%, 44%)",
    accent: "hsl(0, 0%, 96%)",
    accentForeground: "hsl(0, 0%, 9%)",
    destructive: "hsl(357, 100%, 45%)",
    destructiveForeground: "hsl(0, 0%, 96%)",
    border: "hsl(0, 0%, 90%)",
    input: "hsl(0, 0%, 90%)",
    ring: "hsl(0, 0%, 63%)",
  },
  dark: {
    background: "hsl(0, 0%, 4%)",
    foreground: "hsl(0, 0%, 98%)",
    card: "hsl(0, 0%, 10%)",
    cardForeground: "hsl(0, 0%, 98%)",
    popover: "hsl(0, 0%, 15%)",
    popoverForeground: "hsl(0, 0%, 98%)",
    primary: "hsl(0, 0%, 45%)",
    primaryForeground: "hsl(0, 0%, 98%)",
    secondary: "hsl(0, 0%, 15%)",
    secondaryForeground: "hsl(0, 0%, 98%)",
    muted: "hsl(0, 0%, 15%)",
    mutedForeground: "hsl(0, 0%, 63%)",
    accent: "hsl(0, 0%, 25%)",
    accentForeground: "hsl(0, 0%, 98%)",
    destructive: "hsl(359, 100%, 70%)",
    destructiveForeground: "hsl(0, 0%, 15%)",
    border: "hsl(0, 0%, 22%)",
    input: "hsl(0, 0%, 32%)",
    ring: "hsl(0, 0%, 45%)",
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
