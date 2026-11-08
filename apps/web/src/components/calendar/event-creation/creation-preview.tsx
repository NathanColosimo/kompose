"use client";

import { formatTimeRange } from "@kompose/state/temporal-utils";
import { memo, useEffect, useMemo, useRef } from "react";
import type { Temporal } from "temporal-polyfill";
import { minutesFromMidnight } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { PIXELS_PER_HOUR } from "../constants";
import {
  DEFAULT_EVENT_DURATION_MINUTES,
  useEventCreation,
} from "./use-event-creation";

interface CreationPreviewProps {
  columnDate: Temporal.PlainDate;
}

export const CreationPreview = memo(function CreationPreviewComponent({
  columnDate,
}: CreationPreviewProps) {
  const { state, actions, popoverTimes } = useEventCreation();
  const { isCreating, hoverDateTime, startDateTime, endDateTime } = state;
  const previewRef = useRef<HTMLDivElement>(null);

  const previewData = useMemo(() => {
    if (isCreating && startDateTime && endDateTime) {
      const startDate = startDateTime.toPlainDate();
      if (!startDate.equals(columnDate)) {
        return null;
      }
      return {
        end: endDateTime,
        start: startDateTime,
        type: "creating" as const,
      };
    }

    if (state.showPopover && popoverTimes) {
      const startDate = popoverTimes.start.toPlainDate();
      if (!startDate.equals(columnDate)) {
        return null;
      }
      return {
        end: popoverTimes.end,
        start: popoverTimes.start,
        type: "creating" as const,
      };
    }

    if (hoverDateTime && !isCreating) {
      const hoverDate = hoverDateTime.toPlainDate();
      if (!hoverDate.equals(columnDate)) {
        return null;
      }
      // The hover preview is what a click creates: from the hovered slot.
      return {
        end: hoverDateTime.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES }),
        start: hoverDateTime,
        type: "hover" as const,
      };
    }

    return null;
  }, [
    isCreating,
    startDateTime,
    endDateTime,
    hoverDateTime,
    columnDate,
    state.showPopover,
    popoverTimes,
  ]);

  // Register preview element when popover should be shown (for positioning)
  const isPopoverPreview =
    previewData?.type === "creating" && state.showPopover;
  useEffect(() => {
    if (isPopoverPreview && previewRef.current) {
      actions.setPreviewElement(previewRef.current);
    }
    return () => {
      // Only clear if this was the one that set it
      if (isPopoverPreview) {
        actions.setPreviewElement(null);
      }
    };
  }, [isPopoverPreview, actions]);

  if (!previewData) {
    return null;
  }

  const { type, start, end } = previewData;

  const startMinutes = minutesFromMidnight(start);
  const durationMinutes = Math.round(
    end.since(start).total({ unit: "minutes" })
  );
  const top = (startMinutes / 60) * PIXELS_PER_HOUR;
  // Keep short previews aligned to a 15-minute slot height (20px).
  const height = Math.max((durationMinutes / 60) * PIXELS_PER_HOUR, 20);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-0 left-0 z-10 mx-0.5 rounded-md transition-all",
        type === "hover"
          ? "border border-primary/30 bg-primary/5"
          : "border-2 border-primary/50 bg-primary/15"
      )}
      ref={previewRef}
      style={{
        height: `${height}px`,
        top: `${top}px`,
      }}
    >
      {/* What a drag will create, as it grows: "1:00 – 2:30 PM". */}
      {type === "creating" ? (
        <span className="block truncate px-1.5 text-[11px] text-foreground/80 tabular-nums leading-[18px]">
          {formatTimeRange(start, end)}
        </span>
      ) : null}
    </div>
  );
});

CreationPreview.displayName = "CreationPreview";
