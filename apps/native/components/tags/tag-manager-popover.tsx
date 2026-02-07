import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { Check, Pencil, Tag as TagIcon, X } from "lucide-react-native";
import React from "react";
import { Pressable, TextInput, View } from "react-native";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { RadioButton } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import { useColor } from "@/hooks/useColor";
import { type TagIconName, tagIconMap } from "./tag-icon-map";
import { TagIconPicker } from "./tag-icon-picker";

interface TagManagerPopoverProps {
  /** Currently selected tag ID for filtering (null = show all) */
  value: string | null;
  /** Called when the user selects a tag or clears selection */
  onChange: (next: string | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function TagManagerPopover({
  onChange,
  onOpenChange,
  open,
  value,
}: TagManagerPopoverProps) {
  const { tagsQuery, createTag, updateTag, deleteTag } = useTags();
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState<TagIconName>("Tag");
  const [deleteTarget, setDeleteTarget] = React.useState<TagSelect | null>(
    null
  );
  const [tagDrafts, setTagDrafts] = React.useState<
    Record<string, { icon: TagIconName; name: string }>
  >({});
  const [iconPickerTagId, setIconPickerTagId] = React.useState<string | null>(
    null
  );
  const borderColor = useColor("border");
  const textColor = useColor("text");
  const mutedColor = useColor("textMuted");

  const tags = tagsQuery.data ?? [];

  React.useEffect(() => {
    if (open && tags.length === 0) {
      setIsEditMode(true);
    }
  }, [open, tags.length]);

  React.useEffect(() => {
    if (!open) {
      setIconPickerTagId(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setTagDrafts((previous) => {
      const next: Record<string, { icon: TagIconName; name: string }> = {};
      for (const tag of tags) {
        const draft = previous[tag.id];
        next[tag.id] = {
          icon: draft?.icon ?? tag.icon,
          name: draft?.name ?? tag.name,
        };
      }
      return next;
    });
  }, [open, tags]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || createTag.isPending) {
      return;
    }
    createTag.mutate(
      { name: trimmed, icon },
      {
        onSuccess: () => {
          setName("");
        },
      }
    );
  };

  // Single-select: set the tag as the active filter or toggle off if already selected
  const handleSelectTag = (tag: TagSelect) => {
    const next = value === tag.id ? null : tag.id;
    onChange(next);
    onOpenChange(false);
  };

  // Clear filter to show all tasks
  const handleShowAll = () => {
    onChange(null);
    onOpenChange(false);
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteTag.isPending) {
      return;
    }
    deleteTag.mutate(deleteTarget.id, {
      onSettled: () => {
        setDeleteTarget(null);
        // If the deleted tag was selected, clear the filter
        if (value === deleteTarget.id) {
          onChange(null);
        }
      },
    });
  };

  const handleSaveEdit = (tag: TagSelect) => {
    if (updateTag.isPending) {
      return;
    }
    const draft = tagDrafts[tag.id];
    const trimmed = (draft?.name ?? tag.name).trim();
    const nextIcon = draft?.icon ?? tag.icon;
    if (!trimmed) {
      return;
    }
    updateTag.mutate(
      { id: tag.id, name: trimmed, icon: nextIcon },
      {
        onSuccess: () => {
          setTagDrafts((previous) => ({
            ...previous,
            [tag.id]: { icon: nextIcon, name: trimmed },
          }));
        },
      }
    );
  };

  const toggleEditMode = React.useCallback(() => {
    if (tags.length === 0) {
      setIsEditMode(true);
      return;
    }
    setIsEditMode((prev) => !prev);
    setIconPickerTagId(null);
  }, [tags.length]);

  let tagListContent: React.ReactNode = null;
  if (tagsQuery.isLoading) {
    tagListContent = (
      <Text className="text-muted-foreground text-sm">Loading tags...</Text>
    );
  } else if (tags.length === 0 && !isEditMode) {
    tagListContent = (
      <Text className="text-muted-foreground text-sm">No tags yet.</Text>
    );
  } else if (isEditMode) {
    // Edit mode: show editable tag list
    tagListContent = (
      <View className="gap-2">
        {tags.map((tag) => {
          const IconComponent = tagIconMap[tag.icon];
          const draft = tagDrafts[tag.id];
          const draftName = draft?.name ?? tag.name;
          const draftIcon = draft?.icon ?? tag.icon;
          const hasChanges =
            draftName.trim() !== tag.name || draftIcon !== tag.icon;
          return (
            <View
              className="gap-1.5 rounded-md border border-border"
              key={tag.id}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <View
                className="flex-row items-center gap-2"
                style={{ minHeight: 40 }}
              >
                <Pressable
                  className="h-7 w-7 items-center justify-center rounded-full"
                  onPress={() =>
                    setIconPickerTagId((current) =>
                      current === tag.id ? null : tag.id
                    )
                  }
                >
                  <Icon
                    as={IconComponent}
                    className="text-muted-foreground"
                    size={15}
                  />
                </Pressable>
                <View
                  style={{
                    alignItems: "center",
                    borderColor,
                    borderRadius: 10,
                    borderWidth: 1,
                    flex: 1,
                    flexDirection: "row",
                    height: 34,
                    paddingHorizontal: 10,
                  }}
                >
                  <TextInput
                    onChangeText={(nextName) =>
                      setTagDrafts((previous) => ({
                        ...previous,
                        [tag.id]: {
                          icon: previous[tag.id]?.icon ?? tag.icon,
                          name: nextName,
                        },
                      }))
                    }
                    onSubmitEditing={() => handleSaveEdit(tag)}
                    placeholder="Tag name"
                    placeholderTextColor={mutedColor}
                    style={{
                      color: textColor,
                      flex: 1,
                      fontSize: 14,
                      paddingVertical: 0,
                    }}
                    value={draftName}
                  />
                </View>
                <Button
                  accessibilityLabel="Save tag"
                  disabled={
                    !(hasChanges && draftName.trim()) || updateTag.isPending
                  }
                  onPress={() => handleSaveEdit(tag)}
                  size="icon"
                  style={{ height: 28, width: 28 }}
                  variant="secondary"
                >
                  <Icon as={Check} />
                </Button>
                <Button
                  accessibilityLabel={`Delete ${tag.name}`}
                  onPress={() => setDeleteTarget(tag)}
                  size="icon"
                  style={{ height: 28, width: 28 }}
                  variant="ghost"
                >
                  <Icon as={X} className="text-muted-foreground" />
                </Button>
              </View>

              {iconPickerTagId === tag.id ? (
                <TagIconPicker
                  onChange={(nextIcon) =>
                    setTagDrafts((previous) => ({
                      ...previous,
                      [tag.id]: {
                        icon: nextIcon,
                        name: previous[tag.id]?.name ?? tag.name,
                      },
                    }))
                  }
                  value={draftIcon}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    );
  } else {
    // Selection mode: show selectable tag list with "Show all" option
    tagListContent = (
      <View className="gap-2">
        {/* "Show all" option at top */}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: value === null }}
          className="flex-row items-center gap-2 rounded-md border border-border px-2 py-1.5"
          onPress={handleShowAll}
        >
          <Icon as={TagIcon} className="text-muted-foreground" size={14} />
          <Text className="flex-1 text-xs">All tasks</Text>
          <SelectionRadio selected={value === null} />
        </Pressable>

        {/* Individual tag options */}
        {tags.map((tag) => {
          const IconComponent = tagIconMap[tag.icon];
          const isSelected = value === tag.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              className="flex-row items-center gap-2 rounded-md border border-border px-2 py-1.5"
              key={tag.id}
              onPress={() => handleSelectTag(tag)}
            >
              <Icon
                as={IconComponent}
                className="text-muted-foreground"
                size={14}
              />
              <Text className="flex-1 text-xs">{tag.name}</Text>
              <SelectionRadio selected={isSelected} />
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <BottomSheet
        headerRight={
          <Button
            accessibilityLabel={isEditMode ? "Exit edit mode" : "Edit tags"}
            onPress={toggleEditMode}
            size="icon"
            variant={isEditMode ? "secondary" : "ghost"}
          >
            <Icon as={Pencil} />
          </Button>
        }
        isVisible={open}
        onClose={() => onOpenChange(false)}
        snapPoints={[0.55, 0.82, 0.95]}
        title="Tags"
      >
        <View className="gap-3">
          {tagListContent}

          {isEditMode ? (
            <View className="gap-2 border-border border-t pt-3">
              <Text className="text-muted-foreground text-xs uppercase tracking-wide">
                Create tag
              </Text>
              <Input
                onChangeText={setName}
                placeholder="Tag name"
                value={name}
              />
              <TagIconPicker onChange={setIcon} value={icon} />
              <Button
                disabled={!name.trim() || createTag.isPending}
                onPress={handleCreate}
              >
                {createTag.isPending ? (
                  <Text>Creating...</Text>
                ) : (
                  <>
                    <Icon as={TagIcon} className="text-primary-foreground" />
                    <Text>Create tag</Text>
                  </>
                )}
              </Button>
            </View>
          ) : null}
        </View>
      </BottomSheet>

      <AlertDialog
        cancelText="Cancel"
        confirmText={deleteTag.isPending ? "Deleting..." : "Delete"}
        description="This will remove the tag from all tasks."
        isVisible={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete tag?"
      />
    </>
  );
}

function SelectionRadio({ selected }: { selected: boolean }) {
  return (
    <View pointerEvents="none">
      <RadioButton
        labelStyle={{ fontSize: 0, lineHeight: 0, width: 0 }}
        onPress={() => undefined}
        option={{ label: "", value: "selected" }}
        selected={selected}
        style={{ paddingHorizontal: 0, paddingVertical: 0 }}
      />
    </View>
  );
}
