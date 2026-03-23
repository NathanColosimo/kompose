"use client";

import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";

interface DayHeaderProps {
  date: Temporal.PlainDate;
  isTodayHighlight: boolean;
  whoopSummary?: WhoopDaySummary | null;
  width: string;
}

/** Recovery score color: green (67-100), yellow (34-66), red (0-33) */
function recoveryColor(score: number): string {
  if (score >= 67) {
    return "bg-emerald-500";
  }
  if (score >= 34) {
    return "bg-amber-400";
  }
  return "bg-red-500";
}

export const DayHeader = memo(function DayHeaderInner({
  date,
  isTodayHighlight,
  width,
  whoopSummary,
}: DayHeaderProps) {
  const hasWhoopData =
    whoopSummary &&
    (whoopSummary.recoveryScore !== null ||
      whoopSummary.strainScore !== null ||
      whoopSummary.sleepPerformance !== null ||
      whoopSummary.kilojoule !== null);

  const calories =
    whoopSummary?.kilojoule == null
      ? null
      : Math.round(whoopSummary.kilojoule * 0.239_006);

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center border-border border-r last:border-r-0",
        hasWhoopData ? "gap-0.5 py-1.5" : "h-12",
        isTodayHighlight ? "bg-primary/5" : ""
      )}
      style={{ width, scrollSnapAlign: "start" }}
    >
      <div className="flex items-center gap-2">
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

      {hasWhoopData ? (
        <div className="flex items-center gap-1.5">
          {whoopSummary.sleepPerformance === null ? null : (
            <span className="text-[10px] text-muted-foreground">
              😴{whoopSummary.sleepPerformance}%
            </span>
          )}
          {whoopSummary.recoveryScore === null ? null : (
            <span className="flex items-center gap-0.5">
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  recoveryColor(whoopSummary.recoveryScore)
                )}
              />
              <span className="font-medium text-[10px] text-muted-foreground">
                {whoopSummary.recoveryScore}
              </span>
            </span>
          )}
          {whoopSummary.strainScore === null ? null : (
            <span className="text-[10px] text-muted-foreground">
              ⚡{whoopSummary.strainScore.toFixed(1)}
            </span>
          )}
          {calories === null ? null : (
            <span className="text-[10px] text-muted-foreground">
              🔥{calories}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
});
