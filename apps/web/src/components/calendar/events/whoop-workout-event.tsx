"use client";

import type { ItemLayout } from "@kompose/state/collision-utils";
import { formatTimeRange } from "@kompose/state/temporal-utils";
import { Activity } from "lucide-react";
import { memo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  isoStringToZonedDateTime,
  minutesFromMidnight,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import {
  BLOCK_RAISE_CLASS,
  blockHorizontalStyle,
  blockStackStyle,
} from "../event-position";
import { BlockContent, eventColor } from "./block-content";

const WORKOUT_COLOR = eventColor("var(--whoop-workout)");

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
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone,
  });
  const dayEnd = dayStart.add({ days: 1 });

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

  const top = (startMinutes / 60) * PIXELS_PER_HOUR;
  const height = Math.max(20, (durationMinutes / 60) * PIXELS_PER_HOUR);

  const label = sportName || "Workout";

  return (
    <div
      className={`pointer-events-auto absolute rounded-md bg-background p-0.5 ${BLOCK_RAISE_CLASS}`}
      style={{
        ...blockHorizontalStyle(layout),
        height: `${height}px`,
        top: `${top}px`,
        ...blockStackStyle(layout?.zIndex),
      }}
      title={[
        `WHOOP workout: ${label}`,
        formatTimeRange(workoutStart, workoutEnd),
        strainScore === null ? null : `strain ${strainScore.toFixed(1)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div
        className={cn(
          "event-surface h-full overflow-hidden rounded-[5px] pr-1.5 pl-2",
          durationMinutes < 30 ? "py-0" : "py-1"
        )}
        style={WORKOUT_COLOR}
      >
        <BlockContent
          details={
            strainScore === null
              ? []
              : [
                  {
                    icon: Activity,
                    label: `Strain ${strainScore.toFixed(1)}`,
                    short: strainScore.toFixed(1),
                  },
                ]
          }
          end={clampedEnd}
          shownEnd={workoutEnd}
          shownStart={workoutStart}
          start={clampedStart}
          title={label}
        />
      </div>
    </div>
  );
});
