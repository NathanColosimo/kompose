import type React from "react";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * App container with safe area handling and background color.
 * Uses Tailwind classes for theming via NativeWind.
 */
export function Container({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background">{children}</SafeAreaView>
  );
}
