import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { Pressable, View } from "react-native";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { tagIconMap } from "./tag-icon-map";

interface TagPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function TagPicker({ value, onChange }: TagPickerProps) {
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  const toggleTag = (tag: TagSelect) => {
    if (value.includes(tag.id)) {
      onChange(value.filter((id) => id !== tag.id));
      return;
    }
    onChange([...value, tag.id]);
  };

  if (tags.length === 0) {
    return (
      <Text className="text-muted-foreground text-xs">
        No tags yet. Create one in the tag manager.
      </Text>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {tags.map((tag) => {
        const IconComponent = tagIconMap[tag.icon];
        const isSelected = value.includes(tag.id);
        return (
          <Pressable
            className="rounded-full"
            key={tag.id}
            onPress={() => toggleTag(tag)}
          >
            <Badge
              style={{
                backgroundColor: isSelected
                  ? "rgba(115, 115, 115, 0.16)"
                  : "transparent",
              }}
              variant="outline"
            >
              <View className="flex-row items-center gap-1">
                <Icon
                  as={IconComponent}
                  className="text-muted-foreground"
                  size={12}
                />
                <Text className="text-xs">{tag.name}</Text>
              </View>
            </Badge>
          </Pressable>
        );
      })}
    </View>
  );
}
