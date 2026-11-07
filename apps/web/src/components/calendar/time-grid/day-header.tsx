"use client";

import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import { todayPlainDateAtom } from "@kompose/state/atoms/current-date";
import { formatDuration } from "@kompose/state/temporal-utils";
import { useAtomValue } from "jotai";
import { Activity, Moon } from "lucide-react";
import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";

interface DayHeaderProps {
  date: Temporal.PlainDate;
  /** Any visible day has WHOOP data, so every header keeps the same height. */
  showWhoopRow: boolean;
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

/** Sleep as decimal hours, "7.2h", to fit a narrow header. */
function formatSleepHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** The day's WHOOP numbers as one sentence, for the tooltip and screen readers. */
function whoopDescription(summary: WhoopDaySummary, calories: number | null) {
  return [
    summary.recoveryScore === null
      ? null
      : `Recovery ${summary.recoveryScore}%`,
    summary.strainScore === null
      ? null
      : `Strain ${summary.strainScore.toFixed(1)}`,
    summary.sleep
      ? `Slept ${formatDuration(Math.round(summary.sleep.totalSleepMilliseconds / 60_000))}${
          summary.sleepPerformance === null
            ? ""
            : ` (${summary.sleepPerformance}% of need)`
        }`
      : null,
    calories === null ? null : `${calories.toLocaleString()} calories`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const DayHeader = memo(function DayHeaderInner({
  date,
  showWhoopRow,
  width,
  whoopSummary,
}: DayHeaderProps) {
  const isTodayHighlight = useAtomValue(todayPlainDateAtom).equals(date);
  const calories =
    whoopSummary?.kilojoule == null
      ? null
      : Math.round(whoopSummary.kilojoule * 0.239_006);
  const description = whoopSummary
    ? whoopDescription(whoopSummary, calories)
    : "";

  return (
    <div
      className={cn(
        "@container flex shrink-0 flex-col justify-center gap-0.5 border-border border-r px-2.5 last:border-r-0",
        showWhoopRow ? "h-[3.75rem]" : "h-12",
        isTodayHighlight ? "bg-foreground/[0.03]" : ""
      )}
      style={{ scrollSnapAlign: "start", width }}
    >
      <div className="flex h-6 items-center gap-1.5">
        <span
          className={cn(
            "text-sm",
            isTodayHighlight
              ? "font-medium text-foreground"
              : "text-muted-foreground"
          )}
        >
          {date.toLocaleString(undefined, { weekday: "short" })}
        </span>
        <span
          className={cn(
            "font-medium text-sm tabular-nums",
            isTodayHighlight
              ? "flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-primary-foreground dark:bg-foreground/15 dark:text-foreground"
              : ""
          )}
        >
          {date.day}
        </span>
      </div>

      {showWhoopRow ? (
        <div
          className="flex h-4 min-w-0 items-center gap-2 overflow-hidden text-[11px] text-muted-foreground tabular-nums"
          title={description || undefined}
        >
          {description ? <span className="sr-only">{description}</span> : null}
          {whoopSummary?.recoveryScore == null ? null : (
            <span aria-hidden className="flex items-center gap-1">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  recoveryColor(whoopSummary.recoveryScore)
                )}
              />
              {whoopSummary.recoveryScore}%
            </span>
          )}
          {whoopSummary?.strainScore == null ? null : (
            <span aria-hidden className="flex items-center gap-1">
              <Activity className="size-3" />
              {whoopSummary.strainScore.toFixed(1)}
            </span>
          )}
          {whoopSummary?.sleep ? (
            <span
              aria-hidden
              className="flex @max-[7rem]:hidden min-w-0 items-center gap-1"
            >
              <Moon className="size-3 shrink-0" />
              <span className="truncate">
                {formatSleepHours(whoopSummary.sleep.totalSleepMilliseconds)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
