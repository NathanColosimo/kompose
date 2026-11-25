"use client";

import { todayPlainDateAtom } from "@kompose/state/atoms/current-date";
import type { DayMetrics } from "@kompose/state/atoms/day-data";
import { formatDuration } from "@kompose/state/temporal-utils";
import { useAtomValue } from "jotai";
import { Activity, Moon } from "lucide-react";
import { memo } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";

interface DayHeaderProps {
  date: Temporal.PlainDate;
  /** The day's numbers from the user's plugins, such as its recovery score. */
  metrics?: DayMetrics;
  /** Every header keeps the stats row, so they all have the same height. */
  showStatsRow: boolean;
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

/** The day's numbers as one sentence, for the tooltip and screen readers. */
function statsDescription(metrics: DayMetrics) {
  const calories = metrics.energy_burned_kcal;
  return [
    metrics.recovery_score === undefined
      ? null
      : `Recovery ${metrics.recovery_score}%`,
    metrics.strain === undefined ? null : `Strain ${metrics.strain.toFixed(1)}`,
    metrics.sleep_duration_min === undefined
      ? null
      : `Slept ${formatDuration(metrics.sleep_duration_min)}${
          metrics.sleep_performance === undefined
            ? ""
            : ` (${metrics.sleep_performance}% of need)`
        }`,
    calories === undefined
      ? null
      : `${Math.round(calories).toLocaleString()} calories`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const DayHeader = memo(function DayHeaderInner({
  date,
  metrics,
  showStatsRow,
  width,
}: DayHeaderProps) {
  const isTodayHighlight = useAtomValue(todayPlainDateAtom).equals(date);
  const description = metrics ? statsDescription(metrics) : "";

  return (
    <div
      className={cn(
        "border-border flex shrink-0 flex-col justify-center gap-0.5 border-r px-2.5 last:border-r-0",
        showStatsRow ? "h-[3.75rem]" : "h-12",
        isTodayHighlight ? "bg-foreground/[0.03]" : ""
      )}
      style={{ scrollSnapAlign: "start", width }}
    >
      <div className="flex h-6 items-center gap-1.5">
        <span
          className={cn(
            "text-sm",
            isTodayHighlight
              ? "text-foreground font-medium"
              : "text-muted-foreground"
          )}
        >
          {date.toLocaleString(undefined, { weekday: "short" })}
        </span>
        <span
          className={cn(
            "text-sm font-medium tabular-nums",
            isTodayHighlight
              ? "bg-primary text-primary-foreground dark:bg-foreground/15 dark:text-foreground flex h-6 min-w-6 items-center justify-center rounded-full px-1.5"
              : ""
          )}
        >
          {date.day}
        </span>
      </div>

      {showStatsRow ? (
        <div
          className="text-muted-foreground flex h-4 min-w-0 flex-wrap items-center gap-x-2 overflow-hidden text-[11px] tabular-nums"
          title={description || undefined}
        >
          {description ? <span className="sr-only">{description}</span> : null}
          {/* Recovery and strain take the width of their widest values,
              "100%" and "21.0", so every column lays out the same and the
              sleep item shows or hides in all of them at once. */}
          {metrics?.recovery_score === undefined ? null : (
            <span
              aria-hidden
              className="flex min-w-[calc(4ch+0.625rem)] items-center gap-1"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  recoveryColor(metrics.recovery_score)
                )}
              />
              {metrics.recovery_score}%
            </span>
          )}
          {metrics?.strain === undefined ? null : (
            <span
              aria-hidden
              className="flex min-w-[calc(3ch+1rem)] items-center gap-1"
            >
              <Activity className="size-3" />
              {metrics.strain.toFixed(1)}
            </span>
          )}
          {metrics?.sleep_duration_min === undefined ? null : (
            <span
              aria-hidden
              className="@container flex min-w-[1.625rem] flex-1 items-center gap-1"
            >
              <Moon className="size-3 shrink-0" />
              <span className="truncate @max-[2rem]:hidden">
                {formatDuration(metrics.sleep_duration_min).replace(" ", "")}
              </span>
              {/* Too narrow for even "8…": a clean "…", not a cut glyph. */}
              <span className="hidden @max-[2rem]:inline">…</span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
});
