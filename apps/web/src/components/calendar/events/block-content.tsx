import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Temporal } from "temporal-polyfill";
import { formatTime, formatTimeRange } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";

/** Sets --event for the event-surface utility; falls back to the ink color. */
export function eventColor(color: string | null | undefined) {
  return { "--event": color ?? "var(--foreground)" } as CSSProperties;
}

export interface BlockDetail {
  icon: LucideIcon;
  label: string;
}

interface BlockContentProps {
  /** Extra facts after the time, such as a meeting link, place, or tag. */
  details?: BlockDetail[];
  /** Start and end of the visible part, which sets how much fits. */
  end: Temporal.ZonedDateTime;
  /** Shown before the title, such as a task's checkbox. */
  leading?: ReactNode;
  start: Temporal.ZonedDateTime;
  /** Done tasks: muted and struck through. */
  struck?: boolean;
  title: string;
}

/**
 * The text inside a timed calendar block. How much shows depends on the
 * block's length: under 30 minutes is one line with the start time, under
 * an hour adds the time range and details on a second line, and longer
 * blocks give the title two lines and the details their own line.
 */
export function BlockContent({
  details = [],
  end,
  leading,
  start,
  struck = false,
  title,
}: BlockContentProps) {
  const minutes = Math.round(end.since(start).total({ unit: "minutes" }));
  const titleClass = cn(
    "min-w-0 font-medium text-xs leading-4",
    struck ? "text-muted-foreground line-through" : ""
  );

  if (minutes < 30) {
    return (
      <div className="@container flex h-full min-w-0 items-center gap-1.5">
        {leading}
        <span className={cn(titleClass, "truncate")}>{title}</span>
        <span className="@max-[9rem]:hidden shrink-0 text-[11px] text-foreground/65 tabular-nums">
          {formatTime(start)}
        </span>
      </div>
    );
  }

  const isTall = minutes >= 60;
  const time = formatTimeRange(start, end);
  // Short blocks show each detail as an icon after the time; tall ones
  // list them in full.
  const detailIcons = details.map(({ icon: Icon, label }) => (
    <Icon
      aria-label={label}
      className="size-3 shrink-0"
      key={label}
      role="img"
    />
  ));
  const detailRows = details.map(({ icon: Icon, label }) => (
    <span className="flex min-w-0 items-center gap-1" key={label}>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  ));

  return (
    <div className="flex min-w-0 items-start gap-1.5">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn(titleClass, isTall ? "line-clamp-2" : "truncate")}>
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/65 tabular-nums leading-[14px]">
          <span className="truncate">{time}</span>
          {isTall ? null : detailIcons}
        </span>
        {isTall && detailRows.length > 0 ? (
          <span className="flex min-w-0 flex-col gap-px text-[11px] text-foreground/65 leading-[14px]">
            {detailRows}
          </span>
        ) : null}
      </div>
    </div>
  );
}
