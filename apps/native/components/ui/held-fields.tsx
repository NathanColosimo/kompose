import type { ReactNode } from "react";
import { View } from "react-native";

/** Keep an in-flight editor's fields out of reach of touch and VoiceOver. */
export function HeldFields({ children, saving }: { children: ReactNode; saving: boolean }) {
  return (
    <View
      accessibilityElementsHidden={saving}
      importantForAccessibility={saving ? "no-hide-descendants" : "auto"}
      pointerEvents={saving ? "none" : "auto"}
      style={saving ? { opacity: 0.6 } : undefined}
    >
      {children}
    </View>
  );
}
