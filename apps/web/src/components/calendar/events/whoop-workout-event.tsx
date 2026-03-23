"use client";

import type { ItemLayout } from "@kompose/state/collision-utils";
import { memo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  formatTime,
  isoStringToZonedDateTime,
  minutesFromMidnight,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";

interface WhoopWorkoutEventProps {
  /** Calendar date this column represents — used for clamping cross-day workouts */
  columnDate: Temporal.PlainDate;
  end: string;
  id: string;
  layout?: ItemLayout;
  sportName: string | null;
  start: string;
  strainScore: number | null;
  timeZone: string;
}

/**
 * Renders a WHOOP workout as a timed event block on the calendar grid.
 * Clamps to the column's day boundaries so cross-midnight workouts render
 * correctly in both day columns.
 */
export const WhoopWorkoutEvent = memo(function WhoopWorkoutEventInner({
  sportName,
  strainScore,
  start,
  end,
  timeZone,
  columnDate,
  layout,
}: WhoopWorkoutEventProps) {
  const workoutStart = isoStringToZonedDateTime(start, timeZone);
  const workoutEnd = isoStringToZonedDateTime(end, timeZone);

  const dayStart = columnDate.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const dayEnd = dayStart.add({ days: 1 });

  // Clamp to column day boundaries
  const clampedStart =
    Temporal.ZonedDateTime.compare(workoutStart, dayStart) < 0
      ? dayStart
      : workoutStart;
  const clampedEnd =
    Temporal.ZonedDateTime.compare(workoutEnd, dayEnd) > 0
      ? dayEnd
      : workoutEnd;

  const startMinutes = minutesFromMidnight(clampedStart);
  const rawEndMinutes = minutesFromMidnight(clampedEnd);
  const endMinutes =
    rawEndMinutes === 0 && startMinutes > 0 ? 1440 : rawEndMinutes;
  const durationMinutes = Math.max(15, endMinutes - startMinutes);

  // Use unclamped times for the display label
  const displayStart = workoutStart;
  const displayEnd = workoutEnd;

  const top = (startMinutes / 60) * PIXELS_PER_HOUR;
  const height = Math.max(20, (durationMinutes / 60) * PIXELS_PER_HOUR);

  const columnIndex = layout?.columnIndex ?? 0;
  const totalColumns = layout?.totalColumns ?? 1;
  const columnSpan = layout?.columnSpan ?? 1;
  const zIndex = layout?.zIndex ?? 1;

  const singleColumnWidth = 100 / totalColumns;
  const columnWidth = singleColumnWidth * columnSpan;
  const leftPercent = columnIndex * singleColumnWidth;

  const label = sportName || "Workout";

  return (
    <div
      className="pointer-events-auto absolute rounded-md bg-background p-px shadow-sm"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${columnWidth}% - 4px)`,
        zIndex,
      }}
    >
      <div
        className={cn(
          "h-full rounded-[5px] border border-teal-600/30 bg-teal-500/15 px-2 dark:border-teal-400/30 dark:bg-teal-400/10",
          durationMinutes < 30 ? "flex items-center" : "py-1"
        )}
      >
        <div className="truncate font-medium text-teal-900 text-xs dark:text-teal-200">
          {strainScore === null ? "" : `⚡${strainScore.toFixed(1)} · `}
          {label}
        </div>
        {durationMinutes >= 30 ? (
          <div className="truncate text-[10px] text-teal-700/80 dark:text-teal-300/70">
            {formatTime(displayStart)} – {formatTime(displayEnd)}
          </div>
        ) : null}
      </div>
    </div>
  );
});
