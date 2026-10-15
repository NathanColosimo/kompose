import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/use-color";

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
        contentStyle: {
          backgroundColor,
        },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: {
          backgroundColor,
        },
        headerTintColor: textColor,
        headerTitleStyle: {
          color: textColor,
        },
        headerTransparent: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Tasks" }} />
    </Stack>
  );
}
