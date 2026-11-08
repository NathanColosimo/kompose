import type { LucideIcon } from "lucide-react-native";
import { Monitor, Moon, Sun } from "lucide-react-native";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/color-scheme-context";

const OPTIONS: {
  icon: LucideIcon;
  label: string;
  value: "light" | "dark" | "system";
}[] = [
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
  { icon: Monitor, label: "System", value: "system" },
];

/**
 * From the accessibility text sizes up, three segments side by side no
 * longer fit their labels ("System" alone outgrows a third of a 375pt
 * phone), so the options stack.
 */
const STACKED_FONT_SCALE = 1.6;

/** Light, Dark, or System, as one segmented control. */
export function ModeToggle() {
  const { userPreference, setColorScheme } = useColorScheme();
  const stacked = useWindowDimensions().fontScale >= STACKED_FONT_SCALE;

  return (
    <View
      accessibilityRole="radiogroup"
      className={`gap-1 p-1 ${stacked ? "flex-col" : "flex-row"}`}
    >
      {OPTIONS.map(({ icon, label, value }) => {
        const selected = userPreference === value;
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            className={`min-h-11 flex-row items-center gap-1.5 ${stacked ? "px-3" : "flex-1 justify-center"} rounded-lg py-2 active:opacity-70 ${selected ? "bg-muted" : ""}`}
            key={value}
            onPress={() => setColorScheme(value)}
          >
            <Icon
              as={icon}
              className={selected ? "text-foreground" : "text-muted-foreground"}
              size={15}
            />
            <Text
              className={`text-sm ${selected ? "font-sans-medium text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
