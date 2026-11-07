"use client";

import { Moon } from "lucide-react";
import { memo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  formatDuration,
  formatTimeRange,
  isoStringToZonedDateTime,
  minutesFromMidnight,
} from "@/lib/temporal-utils";
import { PIXELS_PER_HOUR } from "../constants";

interface WhoopSleepBandProps {
  columnDate: Temporal.PlainDate;
  /** ISO datetime string with offset for sleep end */
  end: string;
  isNap: boolean;
  /** ISO datetime string with offset for sleep start */
  start: string;
  timeZone: string;
  /** Total actual sleep time (light + deep + REM) for the label */
  totalSleepMilliseconds: number;
}

/** Sleep stays behind collision-positioned events. See documents/whoop.md. */
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
    plainTime: { hour: 0, minute: 0, second: 0 },
    timeZone,
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

  return (
    <div
      className="pointer-events-none absolute inset-x-0 rounded-sm bg-whoop-sleep/8 dark:bg-whoop-sleep/15"
      style={{
        height: `${height}px`,
        top: `${top}px`,
        zIndex: 0,
      }}
    >
      {isLargerSegment ? (
        <div className="@container flex h-full items-end justify-center overflow-hidden p-1.5">
          <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-background/75 px-2 py-1 text-[11px] text-whoop-sleep-foreground leading-[14px] backdrop-blur-sm">
            <Moon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              <span className="font-medium">
                {formatDuration(
                  totalSleepMilliseconds > 0
                    ? Math.round(totalSleepMilliseconds / 60_000)
                    : totalInBedMinutes
                )}
              </span>{" "}
              {isNap ? "nap" : "asleep"}
              <span className="@max-[13rem]:hidden">
                {" "}
                · {formatTimeRange(sleepStart, sleepEnd)}
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
});
