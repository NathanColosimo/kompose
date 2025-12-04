"use client";

import { useDroppable } from "@dnd-kit/core";
import { format, setHours, setMinutes } from "date-fns";
import { memo } from "react";
import { cn } from "@/lib/utils";

/** Grid always shows full 24 hours (0-23), scrollable to show ~12 at a time */
export const CALENDAR_START_HOUR = 0;

/** Regex for parsing slot IDs - moved to top level for performance */
const SLOT_ID_REGEX = /^slot-(\d{4}-\d{2}-\d{2})-(\d+)-(\d+)$/;

/** All 24 hours of the day */
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Generate array of hours for the time gutter */
export function getHoursRange(): number[] {
  return HOURS;
}

type TimeSlotProps = {
  /** The date this slot belongs to */
  date: Date;
  /** Hour of day (0-23) */
  hour: number;
  /** Whether this is the top half (0-29min) or bottom half (30-59min) */
  isFirstHalf: boolean;
  /** Children (CalendarEvents) to render inside this slot */
  children?: React.ReactNode;
};

/**
 * TimeSlot - A droppable 30-minute time slot in the calendar grid.
 * ID format: `slot-{ISO date}-{hour}-{0|30}` for precise drop targeting.
 */
export const TimeSlot = memo(function TimeSlotInner({
  date,
  hour,
  isFirstHalf,
  children,
}: TimeSlotProps) {
  const minutes = isFirstHalf ? 0 : 30;
  const slotId = `slot-${format(date, "yyyy-MM-dd")}-${hour}-${minutes}`;

  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: {
      date,
      hour,
      minutes,
    },
  });

  return (
    <div
      className={cn(
        "h-10 border-border/30 border-b transition-colors",
        isFirstHalf ? "border-border/50 border-t" : "",
        isOver ? "bg-primary/10" : ""
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
});

type DayColumnProps = {
  /** The date for this column */
  date: Date;
  /** Scheduled tasks/events that fall on this day */
  children?: React.ReactNode;
};

/**
 * DayColumn - A single day column containing all time slots for that day.
 */
export const DayColumn = memo(function DayColumnInner({
  date,
  children,
}: DayColumnProps) {
  const hours = getHoursRange();

  return (
    <div className="relative flex flex-1 flex-col border-border border-r last:border-r-0">
      {/* Time slots for each hour (2 slots per hour = 30min granularity) */}
      {hours.map((hour) => (
        <div className="relative" key={hour}>
          <TimeSlot date={date} hour={hour} isFirstHalf={true} />
          <TimeSlot date={date} hour={hour} isFirstHalf={false} />
        </div>
      ))}
      {/* Overlay container for positioned events */}
      <div className="pointer-events-none absolute inset-0">{children}</div>
    </div>
  );
});

type TimeGutterProps = {
  /** Optional className override */
  className?: string;
};

/**
 * TimeGutter - The left column showing hour labels.
 */
export const TimeGutter = memo(function TimeGutterInner({
  className,
}: TimeGutterProps) {
  const hours = getHoursRange();

  return (
    <div className={cn("flex w-16 shrink-0 flex-col", className)}>
      {hours.map((hour) => {
        // Create a date object just for formatting the hour
        const timeLabel = format(
          setMinutes(setHours(new Date(), hour), 0),
          "h a"
        );

        return (
          <div
            className="relative flex h-20 items-start justify-end pr-2 text-muted-foreground text-xs"
            key={hour}
          >
            {/* Position the label slightly above the hour line */}
            <span className="-translate-y-2">{timeLabel}</span>
          </div>
        );
      })}
    </div>
  );
});

type DayHeaderProps = {
  /** The date to display */
  date: Date;
  /** Whether this day is today */
  isToday: boolean;
};

/**
 * DayHeader - Header cell showing day name and date number.
 */
export const DayHeader = memo(function DayHeaderInner({
  date,
  isToday,
}: DayHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center border-border border-r py-2 last:border-r-0",
        isToday ? "bg-primary/5" : ""
      )}
    >
      <span className="font-medium text-muted-foreground text-xs uppercase">
        {format(date, "EEE")}
      </span>
      <span
        className={cn(
          "mt-1 flex size-8 items-center justify-center rounded-full font-semibold text-lg",
          isToday ? "bg-primary text-primary-foreground" : ""
        )}
      >
        {format(date, "d")}
      </span>
    </div>
  );
});

/**
 * Parse a slot ID to extract date and time information.
 * @param slotId - Format: `slot-{yyyy-MM-dd}-{hour}-{minutes}`
 * @returns Date object with the correct date and time in local timezone, or null if invalid
 */
export function parseSlotId(slotId: string): Date | null {
  const match = slotId.match(SLOT_ID_REGEX);
  if (!match) {
    return null;
  }

  const [, dateStr, hourStr, minutesStr] = match;

  // Parse date components manually to avoid UTC interpretation
  // new Date("2024-12-04") is parsed as UTC, causing timezone shift issues
  const [year, month, day] = dateStr.split("-").map(Number);
  const hour = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);

  // Create date in local timezone
  return new Date(year, month - 1, day, hour, minutes, 0, 0);
}
