import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { tagColorNames } from "@kompose/api/routers/tag/contract";
import { tagColors } from "@kompose/state/tag-colors";
import { Check, X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/ui/icon";

interface TagColorPickerProps {
  onChange: (value: TagSelect["color"]) => void;
  value: TagSelect["color"];
}

/** The tag palette, plus "No color". */
export function TagColorPicker({ value, onChange }: TagColorPickerProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      <Pressable
        accessibilityLabel="No color"
        accessibilityRole="radio"
        accessibilityState={{ selected: value === null }}
        className={`h-9 w-9 items-center justify-center rounded-full border ${value === null ? "border-foreground" : "border-border"}`}
        onPress={() => onChange(null)}
      >
        <Icon as={X} className="text-muted-foreground" size={14} />
      </Pressable>
      {tagColorNames.map((color) => {
        const { label, swatch } = tagColors[color];
        const isActive = value === color;
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            className={`h-9 w-9 items-center justify-center rounded-full border-2 ${isActive ? "border-foreground" : "border-transparent"}`}
            key={color}
            onPress={() => onChange(color)}
          >
            <View
              className="h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: swatch }}
            >
              {isActive ? (
                <Icon as={Check} className="text-black/70" size={14} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
