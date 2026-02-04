"use client";

import { tagIconNames } from "@kompose/api/routers/tag/contract";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type TagIconName, tagIconMap } from "./tag-icon-map";

interface TagIconPickerProps {
  value: TagIconName;
  onChange: (value: TagIconName) => void;
}

export function TagIconPicker({ value, onChange }: TagIconPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {tagIconNames.map((name) => {
        const Icon = tagIconMap[name];
        const isActive = value === name;

        return (
          <Button
            aria-pressed={isActive}
            className={cn(
              "h-8 w-8 p-0",
              isActive ? "bg-primary text-primary-foreground" : ""
            )}
            key={name}
            onClick={() => onChange(name)}
            type="button"
            variant={isActive ? "default" : "outline"}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{name}</span>
          </Button>
        );
      })}
    </div>
  );
}
