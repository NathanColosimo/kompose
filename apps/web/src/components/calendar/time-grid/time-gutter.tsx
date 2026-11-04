"use client";

import { memo } from "react";
import { formatHourLabel } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import { getHoursRange } from "./slot-utils";

/** Pixels, not rem, to stay aligned with the PIXELS_PER_HOUR grid. */
const hourStyle = { height: PIXELS_PER_HOUR };

interface TimeGutterProps {
  className?: string;
}

export const TimeGutter = memo(function TimeGutterInner({
  className,
}: TimeGutterProps) {
  const hours = getHoursRange();
  const labelOffset = PIXELS_PER_HOUR / 2;

  return (
    <div className={cn("flex w-16 shrink-0 flex-col", className)}>
      {hours.map((hour) => (
        <div
          className={cn(
            "relative flex justify-end pr-2 text-muted-foreground text-xs",
            hour === 0 ? "items-start" : "items-center"
          )}
          key={hour}
          style={hourStyle}
        >
          <span style={{ transform: `translateY(-${labelOffset}px)` }}>
            {hour === 0 ? "" : formatHourLabel(hour)}
          </span>
        </div>
      ))}
    </div>
  );
});
