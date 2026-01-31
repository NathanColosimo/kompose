"use client";

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
  /** Reference to the scrollable container for position calculations */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** The PlainDate of this column */
  columnDate: Temporal.PlainDate;
  /** Width of the column (CSS value like "14.28%") */
  columnWidth: string;
}

/**
 * CreationPreview - Shows a preview rectangle during event creation.
 * Renders a faint 30-min block on hover, or a more prominent block during drag.
 */
export const CreationPreview = memo(function CreationPreviewComponent({
  scrollContainerRef,
  columnDate,
  columnWidth,
}: CreationPreviewProps) {
  const { state, actions, popoverTimes } = useEventCreation();
  const { isCreating, hoverDateTime, startDateTime, endDateTime } = state;
  const previewRef = useRef<HTMLDivElement>(null);

  // Determine which preview to show
  const previewData = useMemo(() => {
    // During creation drag, show the creation preview
    if (isCreating && startDateTime && endDateTime) {
      const startDate = startDateTime.toPlainDate();
      // Only show in the column that matches the start date
      if (!startDate.equals(columnDate)) {
        return null;
      }
      return {
        type: "creating" as const,
        start: startDateTime,
        end: endDateTime,
      };
    }

    // When popover is about to show, keep the preview visible
    if (state.showPopover && popoverTimes) {
      const startDate = popoverTimes.start.toPlainDate();
      if (!startDate.equals(columnDate)) {
        return null;
      }
      return {
        type: "creating" as const,
        start: popoverTimes.start,
        end: popoverTimes.end,
      };
    }

    // Show hover preview when not creating
    if (hoverDateTime && !isCreating) {
      const hoverDate = hoverDateTime.toPlainDate();
      if (!hoverDate.equals(columnDate)) {
        return null;
      }
      return {
        type: "hover" as const,
        start: hoverDateTime,
        end: hoverDateTime.add({ minutes: DEFAULT_EVENT_DURATION_MINUTES }),
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

  // Calculate position
  const startMinutes = minutesFromMidnight(start);
  const durationMinutes = Math.round(
    end.since(start).total({ unit: "minutes" })
  );
  const top = (startMinutes / 60) * PIXELS_PER_HOUR;
  const height = Math.max((durationMinutes / 60) * PIXELS_PER_HOUR, 24);

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
        top: `${top}px`,
        height: `${height}px`,
      }}
    />
  );
});

CreationPreview.displayName = "CreationPreview";
