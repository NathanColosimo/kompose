import { Moon, Sun } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/color-scheme-context";

/**
 * Theme mode toggle component.
 *
 * Simple three-way toggle: Light / Dark / System
 */
export function ModeToggle() {
  const { userPreference, setColorScheme, isDarkColorScheme } =
    useColorScheme();

  return (
    <View className="gap-2">
      <Text className="font-semibold text-foreground text-sm">Appearance</Text>
      <View className="flex-row gap-2">
        <Pressable
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-md border p-3 ${
            userPreference === "light"
              ? "border-primary bg-primary/10"
              : "border-border"
          }`}
          onPress={() => setColorScheme("light")}
        >
          <Sun color={isDarkColorScheme ? "#fafafa" : "#0a0a0a"} size={18} />
          <Text className="font-medium text-foreground text-sm">Light</Text>
        </Pressable>

        <Pressable
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-md border p-3 ${
            userPreference === "dark"
              ? "border-primary bg-primary/10"
              : "border-border"
          }`}
          onPress={() => setColorScheme("dark")}
        >
          <Moon color={isDarkColorScheme ? "#fafafa" : "#0a0a0a"} size={18} />
          <Text className="font-medium text-foreground text-sm">Dark</Text>
        </Pressable>

        <Pressable
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-md border p-3 ${
            userPreference === "system"
              ? "border-primary bg-primary/10"
              : "border-border"
          }`}
          onPress={() => setColorScheme("system")}
        >
          <Text className="font-medium text-foreground text-sm">System</Text>
        </Pressable>
      </View>
    </View>
  );
}
