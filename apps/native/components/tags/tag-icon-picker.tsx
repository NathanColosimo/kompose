import { tagIconNames } from "@kompose/api/routers/tag/contract";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { type TagIconName, tagIconMap } from "./tag-icon-map";

interface TagIconPickerProps {
  onChange: (value: TagIconName) => void;
  value: TagIconName;
}

export function TagIconPicker({ value, onChange }: TagIconPickerProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {tagIconNames.map((name) => {
        const IconComponent = tagIconMap[name];
        const isActive = value === name;
        return (
          <Button
            accessibilityLabel={`Select ${name} icon`}
            key={name}
            onPress={() => onChange(name)}
            size="icon"
            style={{ height: 36, width: 36 }}
            variant={isActive ? "secondary" : "outline"}
          >
            <Icon
              as={IconComponent}
              className={cn(
                "text-muted-foreground",
                isActive && "text-foreground"
              )}
              size={16}
            />
          </Button>
        );
      })}
    </View>
  );
}
