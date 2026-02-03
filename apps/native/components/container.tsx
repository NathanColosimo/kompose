import type React from "react";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

/**
 * App container with safe area handling and background color.
 * Uses Tailwind classes for theming via NativeWind.
 */
export function Container({
  children,
  edges,
}: {
  children: React.ReactNode;
  edges?: Edge[];
}) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      {children}
    </SafeAreaView>
  );
}
