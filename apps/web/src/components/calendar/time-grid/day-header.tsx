"use client";

import { format } from "date-fns";
import { memo } from "react";
import { cn } from "@/lib/utils";

type DayHeaderProps = {
  date: Date;
  isTodayHighlight: boolean;
  width: string;
};

export const DayHeader = memo(function DayHeaderInner({
  date,
  isTodayHighlight,
  width,
}: DayHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center justify-center gap-2 border-border border-r",
        isTodayHighlight ? "bg-primary/5" : ""
      )}
      style={{ width, scrollSnapAlign: "start" }}
    >
      <span className="font-medium text-muted-foreground text-xs uppercase">
        {format(date, "EEE")}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full font-semibold text-sm",
          isTodayHighlight ? "bg-primary text-primary-foreground" : ""
        )}
      >
        {format(date, "d")}
      </span>
    </div>
  );
});
