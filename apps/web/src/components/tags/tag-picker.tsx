"use client";

import type { TagSelect } from "@kompose/api/routers/tag/contract";
import { useTags } from "@kompose/state/hooks/use-tags";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { tagIconMap } from "./tag-icon-map";

interface TagPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function TagPicker({ value, onChange }: TagPickerProps) {
  const { tagsQuery } = useTags();
  const tags = tagsQuery.data ?? [];

  const selectedTags = tags.filter((tag) => value.includes(tag.id));

  const toggleTag = (tag: TagSelect) => {
    if (value.includes(tag.id)) {
      onChange(value.filter((id) => id !== tag.id));
      return;
    }
    onChange([...value, tag.id]);
  };

  return (
    <div className="space-y-2">
      {selectedTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => {
            const Icon = tagIconMap[tag.icon];
            return (
              <Badge className="gap-1.5" key={tag.id} variant="secondary">
                <Icon className="h-3 w-3" />
                {tag.name}
              </Badge>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground text-xs">No tags selected.</div>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" type="button" variant="outline">
            Add tags
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2">
          {tags.length === 0 ? (
            <div className="p-2 text-muted-foreground text-xs">
              Create a tag in the header to get started.
            </div>
          ) : (
            <div className="space-y-1">
              {tags.map((tag) => {
                const Icon = tagIconMap[tag.icon];
                const isSelected = value.includes(tag.id);
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      isSelected ? "bg-muted" : ""
                    )}
                    key={tag.id}
                    onClick={() => toggleTag(tag)}
                    type="button"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{tag.name}</span>
                    {isSelected ? <Check className="h-4 w-4" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
