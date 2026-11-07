import type { LucideIcon } from "lucide-react-native";
import { Monitor, Moon, Sun } from "lucide-react-native";
import { Pressable, View } from "react-native";
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

/** Light, Dark, or System, as one segmented control. */
export function ModeToggle() {
  const { userPreference, setColorScheme } = useColorScheme();

  return (
    <View accessibilityRole="radiogroup" className="flex-row gap-1 p-1">
      {OPTIONS.map(({ icon, label, value }) => {
        const selected = userPreference === value;
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 active:opacity-70 ${selected ? "bg-muted" : ""}`}
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
