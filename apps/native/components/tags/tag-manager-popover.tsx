import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { Check, Pencil, Tag as TagIcon, X } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
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
  const [editingTagId, setEditingTagId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editIcon, setEditIcon] = React.useState<TagIconName>("Tag");
  const [showIconPicker, setShowIconPicker] = React.useState(false);

  const tags = tagsQuery.data ?? [];

  React.useEffect(() => {
    if (open && tags.length === 0) {
      setIsEditMode(true);
    }
  }, [open, tags.length]);

  React.useEffect(() => {
    if (!open) {
      setEditingTagId(null);
      setShowIconPicker(false);
    }
  }, [open]);

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

  const startEditing = (tag: TagSelect, openIconPicker = false) => {
    setEditingTagId(tag.id);
    setEditName(tag.name);
    setEditIcon(tag.icon);
    setShowIconPicker(openIconPicker);
  };

  const handleSaveEdit = () => {
    if (!editingTagId || updateTag.isPending) {
      return;
    }
    const trimmed = editName.trim();
    if (!trimmed) {
      return;
    }
    updateTag.mutate(
      { id: editingTagId, name: trimmed, icon: editIcon },
      {
        onSuccess: () => {
          setEditingTagId(null);
          setShowIconPicker(false);
        },
      }
    );
  };

  const isEditing = (tagId: string) => editingTagId === tagId;

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
      <ScrollView
        className="max-h-64"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ maxHeight: 256 }}
      >
        <View className="gap-2">
          {tags.map((tag) => {
            const IconComponent = tagIconMap[tag.icon];
            const editing = isEditing(tag.id);
            return (
              <View
                className="gap-2 rounded-md border border-border px-2 py-2"
                key={tag.id}
              >
                <View className="flex-row items-center gap-2">
                  <Pressable
                    className="rounded-full"
                    onPress={() => startEditing(tag, true)}
                  >
                    <Icon
                      as={IconComponent}
                      className="text-muted-foreground"
                      size={16}
                    />
                  </Pressable>

                  {editing ? (
                    <>
                      <Input
                        containerStyle={{ flex: 1 }}
                        onChangeText={setEditName}
                        value={editName}
                      />
                      <Button
                        accessibilityLabel="Save tag"
                        onPress={handleSaveEdit}
                        size="icon"
                        style={{ height: 32, width: 32 }}
                        variant="secondary"
                      >
                        <Icon as={Check} />
                      </Button>
                      <Button
                        accessibilityLabel="Cancel edit"
                        onPress={() => {
                          setEditingTagId(null);
                          setShowIconPicker(false);
                        }}
                        size="icon"
                        style={{ height: 32, width: 32 }}
                        variant="ghost"
                      >
                        <Icon as={X} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Pressable
                        className="flex-1"
                        onPress={() => startEditing(tag, false)}
                      >
                        <Text className="text-xs">{tag.name}</Text>
                      </Pressable>
                      <Button
                        accessibilityLabel={`Delete ${tag.name}`}
                        onPress={() => setDeleteTarget(tag)}
                        size="icon"
                        style={{ height: 28, width: 28 }}
                        variant="ghost"
                      >
                        <Icon as={X} className="text-muted-foreground" />
                      </Button>
                    </>
                  )}
                </View>

                {editing && showIconPicker ? (
                  <TagIconPicker onChange={setEditIcon} value={editIcon} />
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  } else {
    // Selection mode: show selectable tag list with "Show all" option
    tagListContent = (
      <ScrollView
        className="max-h-64"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ maxHeight: 256 }}
      >
        <View className="gap-2">
          {/* "Show all" option at top */}
          <Pressable
            className={cn(
              "flex-row items-center gap-2 rounded-md border px-2 py-1.5",
              value === null ? "border-primary bg-primary/10" : "border-border"
            )}
            onPress={handleShowAll}
          >
            <Icon as={TagIcon} className="text-muted-foreground" size={14} />
            <Text className="flex-1 text-xs">All tasks</Text>
          </Pressable>

          {/* Individual tag options */}
          {tags.map((tag) => {
            const IconComponent = tagIconMap[tag.icon];
            const isSelected = value === tag.id;
            return (
              <Pressable
                className={cn(
                  "flex-row items-center gap-2 rounded-md border px-2 py-1.5",
                  isSelected ? "border-primary bg-primary/10" : "border-border"
                )}
                key={tag.id}
                onPress={() => handleSelectTag(tag)}
              >
                <Icon
                  as={IconComponent}
                  className="text-muted-foreground"
                  size={14}
                />
                <Text className="flex-1 text-xs">{tag.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      <BottomSheet
        isVisible={open}
        onClose={() => onOpenChange(false)}
        snapPoints={[0.55, 0.82, 0.95]}
        title="Tags"
      >
        <View className="flex-row items-center justify-end">
          <Button
            accessibilityLabel={isEditMode ? "Exit edit mode" : "Edit tags"}
            onPress={() => {
              if (tags.length === 0) {
                setIsEditMode(true);
                return;
              }
              setIsEditMode((prev) => !prev);
              setEditingTagId(null);
              setShowIconPicker(false);
            }}
            size="icon"
            variant={isEditMode ? "secondary" : "ghost"}
          >
            <Icon as={Pencil} />
          </Button>
        </View>

        <View className="mt-3 gap-3">
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
