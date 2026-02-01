import { vars } from "nativewind";

/**
 * NativeWind theme variables for light and dark modes.
 *
 * These must match the CSS variables in global.css.
 * Use these with the `style` prop to dynamically switch themes.
 */
export const themeVars = {
  light: vars({
    "--background": "0 0% 100%",
    "--foreground": "0 0% 3.9%",
    "--card": "0 0% 100%",
    "--card-foreground": "0 0% 3.9%",
    "--popover": "0 0% 100%",
    "--popover-foreground": "0 0% 3.9%",
    "--primary": "0 0% 45%",
    "--primary-foreground": "0 0% 98%",
    "--secondary": "0 0% 96%",
    "--secondary-foreground": "0 0% 9%",
    "--muted": "0 0% 96%",
    "--muted-foreground": "0 0% 44%",
    "--accent": "0 0% 96%",
    "--accent-foreground": "0 0% 9%",
    "--destructive": "357 100% 45%",
    "--destructive-foreground": "0 0% 96%",
    "--border": "0 0% 90%",
    "--input": "0 0% 90%",
    "--ring": "0 0% 63%",
    "--radius": "0rem",
  }),
  dark: vars({
    "--background": "0 0% 3.9%",
    "--foreground": "0 0% 98%",
    "--card": "0 0% 9.8%",
    "--card-foreground": "0 0% 98%",
    "--popover": "0 0% 15%",
    "--popover-foreground": "0 0% 98%",
    "--primary": "0 0% 45%",
    "--primary-foreground": "0 0% 98%",
    "--secondary": "0 0% 15%",
    "--secondary-foreground": "0 0% 98%",
    "--muted": "0 0% 15%",
    "--muted-foreground": "0 0% 63%",
    "--accent": "0 0% 25%",
    "--accent-foreground": "0 0% 98%",
    "--destructive": "359 100% 70%",
    "--destructive-foreground": "0 0% 15%",
    "--border": "0 0% 22%",
    "--input": "0 0% 32%",
    "--ring": "0 0% 45%",
    "--radius": "0rem",
  }),
};
