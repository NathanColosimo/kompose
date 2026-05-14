"use client";

import { tagIconNames } from "@kompose/api/routers/tag/contract";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type TagIconName, tagIconMap } from "./tag-icon-map";

interface TagIconPickerProps {
  onChange: (value: TagIconName) => void;
  value: TagIconName;
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
              "size-8 p-0",
              isActive ? "bg-primary text-primary-foreground" : ""
            )}
            key={name}
            onClick={() => onChange(name)}
            type="button"
            variant={isActive ? "default" : "outline"}
          >
            <Icon className="size-4" />
            <span className="sr-only">{name}</span>
          </Button>
        );
      })}
    </div>
  );
}

interface TagIconPickerPopoverProps {
  children: React.ReactNode;
  onChange: (value: TagIconName) => void;
  value: TagIconName;
}

export function TagIconPickerPopover({
  children,
  onChange,
  value,
}: TagIconPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        side="left"
        sideOffset={8}
      >
        <div className="grid grid-cols-5 gap-0.5">
          {tagIconNames.map((iconName) => {
            const Icon = tagIconMap[iconName];
            const isActive = value === iconName;

            return (
              <button
                className={cn(
                  "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-100",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                key={iconName}
                onClick={() => {
                  onChange(iconName);
                  setOpen(false);
                }}
                type="button"
              >
                <Icon className="size-3.5" />
                <span className="sr-only">{iconName}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
