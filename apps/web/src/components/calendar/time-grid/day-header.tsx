"use client";

import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";

interface DayHeaderProps {
  date: Temporal.PlainDate;
  isTodayHighlight: boolean;
  width: string;
}

export const DayHeader = memo(function DayHeaderInner({
  date,
  isTodayHighlight,
  width,
}: DayHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center justify-center gap-2 border-border border-r last:border-r-0",
        isTodayHighlight ? "bg-primary/5" : ""
      )}
      style={{ width, scrollSnapAlign: "start" }}
    >
      <span className="font-medium text-muted-foreground text-xs uppercase">
        {date.toLocaleString(undefined, { weekday: "short" })}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full font-semibold text-sm",
          isTodayHighlight ? "bg-primary text-primary-foreground" : ""
        )}
      >
        {date.day}
      </span>
    </div>
  );
});
