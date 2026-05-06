"use client";

import { Clock3 } from "lucide-react";
import {
  type Ref,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  /** "HH:mm" string or empty */
  value: string;
  onChange: (value: string) => void;
  /** Interval in minutes between options (default: 15) */
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Icon to show in the trigger (default: Clock3) */
  icon?: React.ReactNode;
  align?: "start" | "center" | "end";
}

/** Generate time slots for 24 hours at the given interval. */
function generateTimeSlots(step: number): string[] {
  const slots: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    );
  }
  return slots;
}

/** Format "HH:mm" to localized 12h or 24h display. */
function formatTimeDisplay(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const ITEM_HEIGHT = 36;

export function TimePicker({
  value,
  onChange,
  step = 15,
  disabled = false,
  placeholder = "Time",
  className,
  icon,
  align = "start",
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const slots = useMemo(() => generateTimeSlots(step), [step]);

  // Auto-scroll to selected time when popover opens
  useLayoutEffect(() => {
    if (!open) return;

    // Use requestAnimationFrame to ensure the DOM has rendered
    requestAnimationFrame(() => {
      if (selectedRef.current) {
        selectedRef.current.scrollIntoView({
          block: "center",
          behavior: "instant",
        });
      } else if (scrollRef.current) {
        // Default to ~8am if no selection
        const defaultIndex = slots.indexOf("08:00");
        if (defaultIndex >= 0) {
          const viewport = scrollRef.current.querySelector(
            "[data-slot=scroll-area-viewport]"
          );
          if (viewport) {
            viewport.scrollTop = defaultIndex * ITEM_HEIGHT - 80;
          }
        }
      }
    });
  }, [open, slots, value]);

  const handleSelect = useCallback(
    (slot: string) => {
      onChange(slot);
      setOpen(false);
    },
    [onChange]
  );

  const displayValue = value ? formatTimeDisplay(value) : null;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "justify-start gap-2 text-left font-medium text-xs",
            !displayValue && "text-muted-foreground",
            className
          )}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          {icon ?? <Clock3 className="h-4 w-4 shrink-0" />}
          <span className="truncate">{displayValue ?? placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[180px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ScrollArea className="h-[280px]" ref={scrollRef}>
          <div className="p-1">
            {slots.map((slot) => {
              const isSelected = slot === value;
              return (
                <Button
                  className="w-full justify-start tabular-nums"
                  key={slot}
                  onClick={() => handleSelect(slot)}
                  ref={isSelected ? (selectedRef as Ref<HTMLButtonElement>) : undefined}
                  size="sm"
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                >
                  {formatTimeDisplay(slot)}
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
