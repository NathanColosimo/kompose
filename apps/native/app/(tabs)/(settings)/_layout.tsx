import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/useColor";
import { useColorScheme } from "@/lib/color-scheme-context";

/**
 * Stack layout for the Settings tab.
 * Native tabs don't render headers, so we need a Stack wrapper.
 */
export default function SettingsLayout() {
  const textColor = useColor("text");
  const { isDarkColorScheme } = useColorScheme();

  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: isDarkColorScheme
          ? "systemMaterialDark"
          : "systemMaterial",
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: textColor,
        headerTitleStyle: {
          color: textColor,
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}
