import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { Tag, X } from "lucide-react-native";
import React from "react";
import { ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { type TagIconName, tagIconMap } from "./tag-icon-map";
import { TagIconPicker } from "./tag-icon-picker";

interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TagManagerDialog({
  open,
  onOpenChange,
}: TagManagerDialogProps) {
  const { tagsQuery, createTag, deleteTag } = useTags();
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState<TagIconName>("Tag");
  const [deleteTarget, setDeleteTarget] = React.useState<TagSelect | null>(
    null
  );

  const tags = tagsQuery.data ?? [];

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

  const handleDelete = () => {
    if (!deleteTarget || deleteTag.isPending) {
      return;
    }
    deleteTag.mutate(deleteTarget.id, {
      onSettled: () => setDeleteTarget(null),
    });
  };

  let tagListContent: React.ReactNode = null;
  if (tagsQuery.isLoading) {
    tagListContent = (
      <Text className="text-muted-foreground text-sm">Loading tags...</Text>
    );
  } else if (tags.length === 0) {
    tagListContent = (
      <Text className="text-muted-foreground text-sm">No tags yet.</Text>
    );
  } else {
    tagListContent = (
      <ScrollView
        className="max-h-32"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ maxHeight: 128 }}
      >
        <View className="gap-2">
          {tags.map((tag) => {
            const IconComponent = tagIconMap[tag.icon];
            return (
              <View
                className="flex-row items-center gap-2 rounded-md border border-border px-2 py-1.5"
                key={tag.id}
              >
                <Icon
                  as={IconComponent}
                  className="text-muted-foreground"
                  size={14}
                />
                <Text className="flex-1 text-xs">{tag.name}</Text>
                <Button
                  accessibilityLabel={`Delete ${tag.name}`}
                  className="h-7 w-7"
                  onPress={() => setDeleteTarget(tag)}
                  size="icon"
                  variant="ghost"
                >
                  <Icon as={X} className="text-muted-foreground" />
                </Button>
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tags</DialogTitle>
            <DialogDescription>Manage your task tags.</DialogDescription>
          </DialogHeader>

          <View className="gap-3">
            <View className="gap-2">
              <Text className="text-muted-foreground text-xs uppercase tracking-wide">
                Tag list
              </Text>
              {tagListContent}
            </View>

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
                    <Icon as={Tag} className="text-primary-foreground" />
                    <Text>Create tag</Text>
                  </>
                )}
              </Button>
            </View>
          </View>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTarget(null);
          }
        }}
        open={Boolean(deleteTarget)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag?</DialogTitle>
            <DialogDescription>
              This will remove the tag from all tasks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onPress={() => setDeleteTarget(null)} variant="ghost">
              <Text>Cancel</Text>
            </Button>
            <Button
              disabled={deleteTag.isPending}
              onPress={handleDelete}
              variant="destructive"
            >
              <Text>Delete</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
