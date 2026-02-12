import { Stack } from "expo-router/stack";
import { useColor } from "@/hooks/useColor";

/**
 * Stack layout for the Chat tab.
 * Native tabs do not render headers by default, so each tab uses a Stack.
 */
export default function ChatLayout() {
  const textColor = useColor("text");
  const backgroundColor = useColor("background");

  return (
    <Stack
      screenOptions={{
        // Keep header opaque so inline controls below are visible.
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
      <Stack.Screen name="index" options={{ title: "Chat" }} />
    </Stack>
  );
}
