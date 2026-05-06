"use client";

import { Timer } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DurationPickerProps {
  /** Duration in minutes */
  value: number | undefined;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  className?: string;
  align?: "start" | "center" | "end";
}

const PRESETS = [
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "45m", value: 45 },
  { label: "1h", value: 60 },
  { label: "1.5h", value: 90 },
  { label: "2h", value: 120 },
  { label: "3h", value: 180 },
  { label: "4h", value: 240 },
] as const;

function formatDuration(minutes: number | undefined): string {
  if (minutes === undefined || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function DurationPicker({
  value,
  onChange,
  disabled = false,
  className,
  align = "start",
}: DurationPickerProps) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");

  const handlePreset = useCallback(
    (minutes: number) => {
      onChange(minutes);
      setOpen(false);
    },
    [onChange]
  );

  const handleCustomSubmit = useCallback(() => {
    const parsed = Number.parseInt(customInput, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
      setCustomInput("");
      setOpen(false);
    }
  }, [customInput, onChange]);

  const displayValue = formatDuration(value);
  const isPresetValue = PRESETS.some((p) => p.value === value);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "justify-start gap-2 text-xs",
            !displayValue && "text-muted-foreground",
            className
          )}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          <Timer className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {displayValue || "Duration"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[220px] p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {PRESETS.map((preset) => {
              const isSelected = value === preset.value;
              return (
                <Button
                  className="h-8 px-2 text-xs"
                  key={preset.value}
                  onClick={() => handlePreset(preset.value)}
                  size="sm"
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>

          {/* Custom input for non-preset values */}
          <div className="flex items-center gap-2">
            <Input
              className="h-7 flex-1 text-xs"
              min={5}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
              placeholder={
                !isPresetValue && value
                  ? `${value} min`
                  : "Custom min"
              }
              step={5}
              type="number"
              value={customInput}
            />
            <Button
              className="h-7 px-2 text-xs"
              disabled={!customInput}
              onClick={handleCustomSubmit}
              size="sm"
              type="button"
              variant="outline"
            >
              Set
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
