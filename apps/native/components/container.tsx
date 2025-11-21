import type React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";

export function Container({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useColorScheme();
  const backgroundColor =
    colorScheme === "dark"
      ? NAV_THEME.dark.background
      : NAV_THEME.light.background;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
