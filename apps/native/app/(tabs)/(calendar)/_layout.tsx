import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/useColor";

/**
 * Stack layout for the Calendar tab.
 * Native tabs don't render headers, so we need a Stack wrapper.
 */
export default function CalendarLayout() {
  const textColor = useColor("text");

  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: "systemMaterial",
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: textColor,
        headerTitleStyle: {
          color: textColor,
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Calendar" }} />
    </Stack>
  );
}
