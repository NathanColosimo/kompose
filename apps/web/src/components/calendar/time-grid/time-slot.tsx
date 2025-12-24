"use client";

import { useDroppable } from "@dnd-kit/core";
import { memo, useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";
import type { SlotData } from "../dnd/types";

interface TimeSlotProps {
  date: Temporal.PlainDate;
  hour: number;
  minutes: number;
  timeZone: string;
  children?: React.ReactNode;
  droppableDisabled?: boolean;
}

export const TimeSlot = memo(function TimeSlotInner({
  date,
  hour,
  minutes,
  timeZone,
  children,
  droppableDisabled,
}: TimeSlotProps) {
  // Build slot ID for droppable identification
  const slotId = `slot-${date.toString()}-${hour}-${minutes}`;

  // Memoize the ZonedDateTime to avoid recreating on every render
  const dateTime = useMemo(
    () =>
      Temporal.ZonedDateTime.from({
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute: minutes,
        timeZone,
      }),
    [date, hour, minutes, timeZone]
  );

  const slotData: SlotData = useMemo(() => ({ dateTime }), [dateTime]);

  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: slotData,
    disabled: droppableDisabled,
  });

  const isThirtyMinuteBoundary = minutes === 0 || minutes === 30;

  return (
    <div
      className={cn(
        "h-5 transition-colors",
        isThirtyMinuteBoundary ? "border-border/50 border-t" : "",
        isOver ? "bg-primary/10" : ""
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
});
