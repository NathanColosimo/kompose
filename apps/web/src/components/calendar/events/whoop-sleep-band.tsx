"use client";

import { memo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  formatTime,
  isoStringToZonedDateTime,
  minutesFromMidnight,
} from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "../constants";

interface WhoopSleepBandProps {
  /** Calendar date this column represents */
  columnDate: Temporal.PlainDate;
  /** ISO datetime string with offset for sleep end */
  end: string;
  /** Whether this is a nap (vs overnight sleep) */
  isNap: boolean;
  /** ISO datetime string with offset for sleep start */
  start: string;
  timeZone: string;
  /** Total actual sleep time (light + deep + REM) for the label */
  totalSleepMilliseconds: number;
}

function formatSleepDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Renders a translucent background band for a WHOOP sleep block.
 * Positioned behind all events (z-0) and does not participate in collision layout.
 * Clamps to the column's day boundaries (midnight-to-midnight).
 * Shows a "Sleep" label with duration on the larger segment when split across days.
 */
export const WhoopSleepBand = memo(function WhoopSleepBandInner({
  start,
  end,
  columnDate,
  isNap,
  timeZone,
  totalSleepMilliseconds,
}: WhoopSleepBandProps) {
  const sleepStart = isoStringToZonedDateTime(start, timeZone);
  const sleepEnd = isoStringToZonedDateTime(end, timeZone);

  const dayStart = columnDate.toZonedDateTime({
    timeZone,
    plainTime: { hour: 0, minute: 0, second: 0 },
  });
  const dayEnd = dayStart.add({ days: 1 });

  if (
    Temporal.ZonedDateTime.compare(sleepEnd, dayStart) <= 0 ||
    Temporal.ZonedDateTime.compare(sleepStart, dayEnd) >= 0
  ) {
    return null;
  }

  const clampedStart =
    Temporal.ZonedDateTime.compare(sleepStart, dayStart) < 0
      ? dayStart
      : sleepStart;
  const clampedEnd =
    Temporal.ZonedDateTime.compare(sleepEnd, dayEnd) > 0 ? dayEnd : sleepEnd;

  const startMinutes = minutesFromMidnight(clampedStart);
  const endMinutes = minutesFromMidnight(clampedEnd);
  const effectiveEndMinutes =
    endMinutes === 0 &&
    Temporal.ZonedDateTime.compare(clampedEnd, clampedStart) > 0
      ? 1440
      : endMinutes;

  const durationMinutes = effectiveEndMinutes - startMinutes;
  if (durationMinutes <= 0) {
    return null;
  }

  const top = (startMinutes / 60) * PIXELS_PER_HOUR;
  const height = (durationMinutes / 60) * PIXELS_PER_HOUR;

  // For overnight sleep split across midnight, show label on the larger
  // chunk only. Naps are short and always show their label.
  const totalInBedMinutes = Math.round(
    sleepEnd.since(sleepStart).total({ unit: "minutes" })
  );
  const isLargerSegment = isNap || durationMinutes >= totalInBedMinutes / 2;
  const label = isNap ? "Nap" : "Sleep";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 rounded-sm bg-indigo-500/8 dark:bg-indigo-400/15"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        zIndex: 0,
      }}
    >
      {isLargerSegment ? (
        <div className="flex h-full items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center gap-0.5 rounded-md bg-background/70 px-2.5 py-1.5 backdrop-blur-sm dark:bg-background/60">
            <span className="font-medium text-[10px] text-indigo-600/80 dark:text-indigo-300/80">
              {label}
            </span>
            <span className="text-[9px] text-indigo-500/70 dark:text-indigo-300/60">
              {formatTime(sleepStart)} – {formatTime(sleepEnd)}
            </span>
            <span className="text-[9px] text-indigo-500/70 dark:text-indigo-300/60">
              {formatSleepDuration(totalInBedMinutes * 60_000)} in bed
            </span>
            {totalSleepMilliseconds > 0 ? (
              <span className="text-[9px] text-indigo-500/70 dark:text-indigo-300/60">
                {formatSleepDuration(totalSleepMilliseconds)} asleep
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
