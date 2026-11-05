"use client";

import { memo, useCallback } from "react";
import { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR, SLOT_HEIGHT } from "../constants";
import { MINUTES_STEP } from "../dnd/helpers";

/** Pixels, not rem, so the grid matches PIXELS_PER_HOUR at any font size. */
const slotStyle = { height: SLOT_HEIGHT };

interface TimeSlotProps {
  children?: React.ReactNode;
  date: Temporal.PlainDate;
  minutes: number;
  onSlotDragMove?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotHover?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotLeave?: () => void;
  onSlotMouseDown?: (dateTime: Temporal.ZonedDateTime) => void;
  onSlotMouseUp?: () => void;
  timeZone: string;
}

export const TimeSlot = memo(function TimeSlotInner({
  date,
  minutes,
  timeZone,
  children,
  onSlotHover,
  onSlotLeave,
  onSlotMouseDown,
  onSlotDragMove,
  onSlotMouseUp,
}: TimeSlotProps) {
  const isThirtyMinuteBoundary = minutes === 0 || minutes === 30;

  const getSnappedDateTimeFromPointer = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const column = event.currentTarget.closest(
        "[data-day-column]"
      ) as HTMLElement;
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
      const snappedHour = Math.floor(clampedMinutes / 60);
      const snappedMinute = clampedMinutes % 60;
      return Temporal.ZonedDateTime.from({
        day: date.day,
        hour: snappedHour,
        minute: snappedMinute,
        month: date.month,
        timeZone,
        year: date.year,
      });
    },
    [date, timeZone]
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
        "block min-h-0 w-full min-w-0 appearance-none border-0 bg-transparent p-0 leading-none",
        isThirtyMinuteBoundary ? "border-border/50 border-t" : ""
      )}
      data-calendar-slot
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseMove}
      onMouseLeave={onSlotLeave}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={slotStyle}
      type="button"
    >
      {children}
    </button>
  );
});
