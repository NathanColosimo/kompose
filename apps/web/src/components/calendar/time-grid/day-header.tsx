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

function formatSleep(milliseconds: number): string {
  return formatDuration(Math.round(milliseconds / 60_000));
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
      ? `Slept ${formatSleep(summary.sleep.totalSleepMilliseconds)}${
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
        "flex shrink-0 flex-col justify-center gap-0.5 border-border border-r px-2.5 last:border-r-0",
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
          className="flex h-4 min-w-0 flex-wrap items-center gap-x-2 overflow-hidden text-[11px] text-muted-foreground tabular-nums"
          title={description || undefined}
        >
          {description ? <span className="sr-only">{description}</span> : null}
          {/* Recovery and strain take the width of their widest values,
              "100%" and "21.0", so every column lays out the same and the
              sleep item shows or hides in all of them at once. */}
          {whoopSummary?.recoveryScore == null ? null : (
            <span
              aria-hidden
              className="flex min-w-[calc(4ch+0.625rem)] items-center gap-1"
            >
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
            <span
              aria-hidden
              className="flex min-w-[calc(3ch+1rem)] items-center gap-1"
            >
              <Activity className="size-3" />
              {whoopSummary.strainScore.toFixed(1)}
            </span>
          )}
          {whoopSummary?.sleep ? (
            <span
              aria-hidden
              className="@container flex min-w-[1.625rem] flex-1 items-center gap-1"
            >
              <Moon className="size-3 shrink-0" />
              <span className="@max-[2rem]:hidden truncate">
                {formatSleep(whoopSummary.sleep.totalSleepMilliseconds).replace(
                  " ",
                  ""
                )}
              </span>
              {/* Too narrow for even "8…": a clean "…", not a cut glyph. */}
              <span className="@max-[2rem]:inline hidden">…</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
