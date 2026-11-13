"use client";

import {
  type TagColorName,
  type TagSelect,
  tagColorNames,
  tagIconNames,
} from "@kompose/api/routers/tag/contract";
import { tagColors } from "@kompose/state/tag-colors";
import { Check } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { tagIconMap } from "./tag-icon-map";

type TagStyle = Pick<TagSelect, "color" | "icon">;

interface TagStylePickerPopoverProps {
  children: React.ReactNode;
  onChange: (change: Partial<TagStyle>) => void;
  value: TagStyle;
}

/** Picks a tag's color from the palette and its icon. */
export function TagStylePickerPopover({
  children,
  onChange,
  value,
}: TagStylePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const pick = (change: Partial<TagStyle>) => {
    onChange(change);
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto gap-1.5 p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        side="left"
        sideOffset={8}
      >
        <div className="grid grid-cols-5 gap-0.5">
          {tagColorNames.map((color) => (
            <ColorSwatch
              color={color}
              isActive={value.color === color}
              key={color}
              onSelect={() => pick({ color })}
            />
          ))}
        </div>
        <button
          aria-pressed={value.color === null}
          className={cn(
            "flex h-7 cursor-pointer items-center justify-between rounded-md px-1.5 text-xs transition-colors duration-100",
            value.color === null
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          onClick={() => pick({ color: null })}
          type="button"
        >
          No color
          {value.color === null ? <Check className="size-3.5" /> : null}
        </button>
        <div className="-mx-1.5 border-t" />
        <div className="grid grid-cols-5 gap-0.5">
          {tagIconNames.map((iconName) => {
            const Icon = tagIconMap[iconName];
            const isActive = value.icon === iconName;

            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-100",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                key={iconName}
                onClick={() => pick({ icon: iconName })}
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

function ColorSwatch({
  color,
  isActive,
  onSelect,
}: {
  color: TagColorName;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { label, swatch } = tagColors[color];
  return (
    <button
      aria-pressed={isActive}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-100 hover:bg-muted"
      onClick={onSelect}
      title={label}
      type="button"
    >
      <span
        className={cn(
          "flex size-4.5 items-center justify-center rounded-full border border-foreground/15",
          isActive
            ? "ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover"
            : ""
        )}
        style={{ backgroundColor: swatch }}
      >
        {isActive ? <Check className="size-3 text-black/70" /> : null}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
