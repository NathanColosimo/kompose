import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/useColor";

/**
 * Stack layout for the Tasks tab.
 * Native tabs don't render headers, so we need a Stack wrapper.
 */
export default function TasksLayout() {
  const textColor = useColor("text");
  const backgroundColor = useColor("background");

  return (
    <Stack
      screenOptions={{
        headerTransparent: false,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: textColor,
        headerStyle: {
          backgroundColor,
        },
        contentStyle: {
          backgroundColor,
        },
        headerTitleStyle: {
          color: textColor,
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Tasks" }} />
    </Stack>
  );
}
