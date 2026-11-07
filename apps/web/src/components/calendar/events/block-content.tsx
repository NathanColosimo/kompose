import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Temporal } from "temporal-polyfill";
import { formatTime, formatTimeRange } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";

/** Sets --event for the event-surface utility; falls back to the ink color. */
export function eventColor(color: string | null | undefined) {
  return { "--event": color ?? "var(--foreground)" } as CSSProperties;
}

/** Secondary text on a tint, at AA contrast on Google's colors in both themes. */
const META = "text-[11px] text-foreground/80 dark:text-foreground/70";

export interface BlockDetail {
  icon: LucideIcon;
  label: string;
  /** Text to keep beside the icon in short blocks, such as a strain score. */
  short?: string;
}

interface BlockContentProps {
  /** Extra facts after the time, such as a meeting link, place, or tag. */
  details?: BlockDetail[];
  /** End of the visible part; with `start` it sets how much fits. */
  end: Temporal.ZonedDateTime;
  /** Shown before the title, such as a task's checkbox. */
  leading?: ReactNode;
  /** The whole item's end, for the time text. Defaults to `end`. */
  shownEnd?: Temporal.ZonedDateTime;
  /** The whole item's start, for the time text. Defaults to `start`. */
  shownStart?: Temporal.ZonedDateTime;
  start: Temporal.ZonedDateTime;
  /** Done tasks: muted and struck through. */
  struck?: boolean;
  title: string;
}

/** An icon with a short value, such as a workout's strain. */
function ShortDetail({ icon: Icon, label, short }: BlockDetail) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Icon aria-hidden className="size-3" />
      <span className="sr-only">{label}</span>
      <span aria-hidden>{short}</span>
    </span>
  );
}

/**
 * The text inside a timed calendar block. How much shows depends on the
 * block's length: under 30 minutes is one line with the start time, under
 * an hour adds the time range and each detail as an icon, and longer
 * blocks give the title two lines and list the details in full.
 */
export function BlockContent({
  details = [],
  end,
  leading,
  shownEnd,
  shownStart,
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
        <span
          className={cn(
            "flex @max-[6rem]:hidden shrink-0 items-center gap-1.5 tabular-nums",
            META
          )}
        >
          {formatTime(shownStart ?? start)}
          {details
            .filter((detail) => detail.short)
            .map((detail) => (
              <ShortDetail key={detail.label} {...detail} />
            ))}
        </span>
      </div>
    );
  }

  const isTall = minutes >= 60;
  const detailIcons = details.map((detail) =>
    detail.short ? (
      <ShortDetail key={detail.label} {...detail} />
    ) : (
      <detail.icon
        aria-label={detail.label}
        className="size-3 shrink-0"
        key={detail.label}
        role="img"
      />
    )
  );
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
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 tabular-nums leading-[14px]",
            META
          )}
        >
          <span className="truncate">
            {formatTimeRange(shownStart ?? start, shownEnd ?? end)}
          </span>
          {isTall ? null : detailIcons}
        </span>
        {isTall && detailRows.length > 0 ? (
          <span
            className={cn("flex min-w-0 flex-col gap-px leading-[14px]", META)}
          >
            {detailRows}
          </span>
        ) : null}
      </div>
    </div>
  );
}
