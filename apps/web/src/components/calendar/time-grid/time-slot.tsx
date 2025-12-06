"use client";

import { useDroppable } from "@dnd-kit/core";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { buildSlotId } from "./slot-utils";

type TimeSlotProps = {
  date: Date;
  hour: number;
  minutes: number;
  children?: React.ReactNode;
  droppableDisabled?: boolean;
};

export const TimeSlot = memo(function TimeSlotInner({
  date,
  hour,
  minutes,
  children,
  droppableDisabled,
}: TimeSlotProps) {
  const slotId = buildSlotId(date, hour, minutes);

  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: {
      date,
      hour,
      minutes,
    },
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
