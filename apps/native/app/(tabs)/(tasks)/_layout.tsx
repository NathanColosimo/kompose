import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/use-color";

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
