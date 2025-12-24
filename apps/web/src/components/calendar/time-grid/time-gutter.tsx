"use client";

import { memo } from "react";
import { formatHourLabel } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { getHoursRange } from "./slot-utils";

interface TimeGutterProps {
  className?: string;
}

export const TimeGutter = memo(function TimeGutterInner({
  className,
}: TimeGutterProps) {
  const hours = getHoursRange();

  return (
    <div className={cn("flex w-16 shrink-0 flex-col", className)}>
      {hours.map((hour) => (
        <div
          className="relative flex h-20 items-start justify-end pr-2 text-muted-foreground text-xs"
          key={hour}
        >
          <span className="-translate-y-2">{formatHourLabel(hour)}</span>
        </div>
      ))}
    </div>
  );
});
