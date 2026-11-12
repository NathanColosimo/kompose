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
import { useColor } from "@/hooks/use-color";
import { TagColorPicker } from "./tag-color-picker";
import { TagGlyph } from "./tag-glyph";
import type { TagIconName } from "./tag-icon-map";
import { TagIconPicker } from "./tag-icon-picker";

interface TagManagerPopoverProps {
  onChange: (next: string | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Currently selected tag ID for filtering (null = show all) */
  value: string | null;
}

export function TagManagerPopover({
  onChange,
  onOpenChange,
  open,
  value,
}: TagManagerPopoverProps) {
  const { tagsQuery, createTag, updateTag, deleteTag } = useTags();
  const [requestedEdit, setRequestedEdit] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState<TagIconName>("Tag");
  const [color, setColor] = React.useState<TagSelect["color"]>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<TagSelect | null>(
    null
  );
  const [tagEdits, setTagEdits] = React.useState<
    Record<string, Partial<Pick<TagSelect, "color" | "icon" | "name">>>
  >({});
  const [iconPickerTagId, setIconPickerTagId] = React.useState<string | null>(
    null
  );
  const editTag = (
    tagId: string,
    edit: Partial<Pick<TagSelect, "color" | "icon" | "name">>
  ) =>
    setTagEdits((previous) => ({
      ...previous,
      [tagId]: { ...previous[tagId], ...edit },
    }));
  const borderColor = useColor("border");
  const textColor = useColor("text");
  const mutedColor = useColor("textMuted");

  const tags = tagsQuery.data ?? [];
  const isEditMode =
    requestedEdit || (tagsQuery.isSuccess && tags.length === 0);

  const handleClose = () => {
    setRequestedEdit(false);
    setName("");
    setIcon("Tag");
    setColor(null);
    setDeleteTarget(null);
    setTagEdits({});
    setIconPickerTagId(null);
    onOpenChange(false);
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || createTag.isPending) {
      return;
    }
    createTag.mutate(
      { color, icon, name: trimmed },
      {
        onSuccess: () => {
          setName("");
        },
      }
    );
  };

  const handleSelectTag = (tag: TagSelect) => {
    const next = value === tag.id ? null : tag.id;
    onChange(next);
    handleClose();
  };

  const handleShowAll = () => {
    onChange(null);
    handleClose();
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteTag.isPending) {
      return;
    }
    deleteTag.mutate(deleteTarget.id, {
      onSettled: () => {
        setDeleteTarget(null);
        if (value === deleteTarget.id) {
          onChange(null);
        }
      },
    });
  };

  const handleSaveEdit = (tag: TagSelect) => {
    const edits = tagEdits[tag.id];
    if (!edits || updateTag.isPending) {
      return;
    }
    const input = { ...edits, id: tag.id };
    if (input.name !== undefined) {
      input.name = input.name.trim();
      if (!input.name) {
        return;
      }
    }
    updateTag.mutate(input, {
      onSuccess: () => {
        setTagEdits((previous) => {
          const current = previous[tag.id];
          const remaining: typeof edits = {};
          if (current?.name !== undefined && current.name !== edits.name) {
            remaining.name = current.name;
          }
          if (current?.icon !== undefined && current.icon !== edits.icon) {
            remaining.icon = current.icon;
          }
          if (current?.color !== undefined && current.color !== edits.color) {
            remaining.color = current.color;
          }
          const next = { ...previous };
          if (Object.keys(remaining).length === 0) {
            delete next[tag.id];
          } else {
            next[tag.id] = remaining;
          }
          return next;
        });
      },
    });
  };

  const toggleEditMode = () => {
    setRequestedEdit((previous) => !previous);
    setIconPickerTagId(null);
  };

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
    tagListContent = (
      <View className="gap-2">
        {tags.map((tag) => {
          const draft = { ...tag, ...tagEdits[tag.id] };
          const hasChanges =
            draft.name.trim() !== tag.name ||
            draft.icon !== tag.icon ||
            draft.color !== tag.color;
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
                  <TagGlyph
                    className="text-muted-foreground"
                    size={15}
                    tag={draft}
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
                      editTag(tag.id, { name: nextName })
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
                    value={draft.name}
                  />
                </View>
                <Button
                  accessibilityLabel="Save tag"
                  disabled={
                    !(hasChanges && draft.name.trim()) || updateTag.isPending
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
                <View className="gap-2">
                  <TagColorPicker
                    onChange={(nextColor) =>
                      editTag(tag.id, { color: nextColor })
                    }
                    value={draft.color}
                  />
                  <TagIconPicker
                    onChange={(nextIcon) => editTag(tag.id, { icon: nextIcon })}
                    value={draft.icon}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  } else {
    tagListContent = (
      <View className="gap-2">
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

        {tags.map((tag) => {
          const isSelected = value === tag.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              className="flex-row items-center gap-2 rounded-md border border-border px-2 py-1.5"
              key={tag.id}
              onPress={() => handleSelectTag(tag)}
            >
              <TagGlyph className="text-muted-foreground" size={14} tag={tag} />
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
        onClose={handleClose}
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
              <TagColorPicker onChange={setColor} value={color} />
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
