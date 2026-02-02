"use client";

import { useDroppable } from "@dnd-kit/core";
import { memo, useCallback, useMemo } from "react";
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
  /** Called when mouse enters the slot (for hover preview) */
  onSlotHover?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse leaves the slot/column */
  onSlotLeave?: () => void;
  /** Called when mouse down on the slot (start event creation) */
  onSlotMouseDown?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse moves over the slot during creation drag */
  onSlotDragMove?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse up on the slot (end event creation) */
  onSlotMouseUp?: () => void;
}

export const TimeSlot = memo(function TimeSlotInner({
  date,
  hour,
  minutes,
  timeZone,
  children,
  droppableDisabled,
  onSlotHover,
  onSlotLeave,
  onSlotMouseDown,
  onSlotDragMove,
  onSlotMouseUp,
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

  // Mouse event handlers for event creation
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      // Only trigger hover if primary button is pressed (during drag) or no buttons pressed
      if (e.buttons === 1 && onSlotDragMove) {
        // Dragging with left button pressed
        onSlotDragMove(dateTime);
      } else if (e.buttons === 0 && onSlotHover) {
        // Just hovering
        onSlotHover(dateTime);
      }
    },
    [dateTime, onSlotHover, onSlotDragMove]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }
      onSlotMouseDown?.(dateTime);
    },
    [dateTime, onSlotMouseDown]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }
      onSlotMouseUp?.();
    },
    [onSlotMouseUp]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") {
        return;
      }
      e.preventDefault();
      onSlotMouseDown?.(dateTime);
      onSlotMouseUp?.();
    },
    [dateTime, onSlotMouseDown, onSlotMouseUp]
  );

  return (
    <button
      className={cn(
        "h-5 w-full appearance-none bg-transparent p-0 text-left transition-colors",
        isThirtyMinuteBoundary ? "border-border/50 border-t" : "",
        isOver ? "bg-primary/10" : ""
      )}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onSlotLeave}
      onMouseUp={handleMouseUp}
      ref={setNodeRef}
      type="button"
    >
      {children}
    </button>
  );
});
