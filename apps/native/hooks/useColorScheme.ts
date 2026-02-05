import { useColorScheme as useAppColorScheme } from "@/lib/color-scheme-context";

export function useColorScheme(): "light" | "dark" {
  const { colorScheme } = useAppColorScheme();
  return colorScheme;
}
