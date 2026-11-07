import { formatTimeRange } from "@kompose/state/temporal-utils";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Temporal } from "temporal-polyfill";
import { formatTime } from "@/lib/temporal-utils";
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

/** `leading` (a task's checkbox), left out of narrow blocks for the title. */
function narrowHidden(leading: ReactNode) {
  return leading ? (
    <span className="flex @max-[5.5rem]:hidden shrink-0">{leading}</span>
  ) : null;
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
        {narrowHidden(leading)}
        {/* One visible line: the time wraps onto a hidden second line when
            it doesn't fit beside the whole title, so the title wins. */}
        <div className="flex h-4 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 overflow-hidden">
          <span className={cn(titleClass, "max-w-full truncate")}>{title}</span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 tabular-nums",
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

  // In a narrow block (side by side on a busy day) the title is what
  // matters: it takes the time line's and the checkbox's room and
  // hyphenates long words; the time is in the hover text, and done is in
  // the popover.
  return (
    <div className="@container flex min-w-0 items-start gap-1.5">
      {narrowHidden(leading)}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className={cn(
            titleClass,
            // Hyphenate where the browser can; otherwise break a word that
            // can't fit rather than clip it.
            "hyphens-auto [overflow-wrap:break-word]",
            isTall
              ? "@max-[5.5rem]:line-clamp-3 line-clamp-2"
              : "@max-[5.5rem]:line-clamp-2 truncate @max-[5.5rem]:whitespace-normal"
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "flex @max-[5.5rem]:hidden min-w-0 items-center gap-1.5 tabular-nums leading-[14px]",
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
            className={cn(
              "flex @max-[5.5rem]:hidden min-w-0 flex-col gap-px leading-[14px]",
              META
            )}
          >
            {detailRows}
          </span>
        ) : null}
      </div>
    </div>
  );
}
