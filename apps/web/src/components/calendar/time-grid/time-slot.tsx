"use client";

import { useDroppable } from "@dnd-kit/core";
import { memo, useCallback, useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import { MINUTES_STEP } from "../dnd/helpers";
import type { SlotData } from "../dnd/types";

interface TimeSlotProps {
  children?: React.ReactNode;
  date: Temporal.PlainDate;
  droppableDisabled?: boolean;
  hour: number;
  minutes: number;
  /** Called when mouse moves over the slot during creation drag */
  onSlotDragMove?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse enters the slot (for hover preview) */
  onSlotHover?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse leaves the slot/column */
  onSlotLeave?: () => void;
  /** Called when mouse down on the slot (start event creation) */
  onSlotMouseDown?: (dateTime: Temporal.ZonedDateTime) => void;
  /** Called when mouse up on the slot (end event creation) */
  onSlotMouseUp?: () => void;
  timeZone: string;
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

  const getSnappedDateTimeFromPointer = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const column = event.currentTarget.closest(
        "[data-day-column]"
      ) as HTMLElement | null;
      if (!column) {
        return dateTime;
      }
      const rect = column.getBoundingClientRect();
      const offsetY = Math.min(
        Math.max(event.clientY - rect.top, 0),
        rect.height
      );
      const minutesFromTop = (offsetY / PIXELS_PER_HOUR) * 60;
      // Snap to the nearest grid step so hover/drag align with 15-min slots.
      const snappedMinutes =
        Math.round(minutesFromTop / MINUTES_STEP) * MINUTES_STEP;
      const clampedMinutes = Math.min(
        Math.max(snappedMinutes, 0),
        24 * 60 - MINUTES_STEP
      );
      const hour = Math.floor(clampedMinutes / 60);
      const minute = clampedMinutes % 60;
      return Temporal.ZonedDateTime.from({
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute,
        timeZone,
      });
    },
    [date, timeZone, dateTime]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const snappedDateTime = getSnappedDateTimeFromPointer(e);
      if (e.buttons === 1 && onSlotDragMove) {
        onSlotDragMove(snappedDateTime);
        return;
      }
      if (e.buttons === 0 && onSlotHover) {
        onSlotHover(snappedDateTime);
      }
    },
    [getSnappedDateTimeFromPointer, onSlotDragMove, onSlotHover]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      onSlotMouseDown?.(getSnappedDateTimeFromPointer(e));
    },
    [getSnappedDateTimeFromPointer, onSlotMouseDown]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Only handle left mouse button
      if (e.button !== 0) {
        return;
      }
      onSlotMouseUp?.();
    },
    [onSlotMouseUp]
  );

  return (
    <button
      className={cn(
        "block h-5 min-h-0 w-full min-w-0 appearance-none border-0 bg-transparent p-0 leading-none transition-colors",
        isThirtyMinuteBoundary ? "border-border/50 border-t" : "",
        isOver ? "bg-primary/10" : ""
      )}
      data-calendar-slot
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseMove}
      onMouseLeave={onSlotLeave}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      ref={setNodeRef}
      type="button"
    >
      {children}
    </button>
  );
});
