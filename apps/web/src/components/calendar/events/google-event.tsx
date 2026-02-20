"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  resolveGoogleEventColors,
} from "@kompose/state/atoms/google-colors";
import { googleCalendarsDataAtom } from "@kompose/state/atoms/google-data";
import { recurringEventMasterQueryOptions } from "@kompose/state/hooks/use-recurring-event-master";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";
import type { Temporal } from "temporal-polyfill";
import { formatTime, zonedDateTimeToDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { calculateEventPosition } from "../days-view";
import { EventEditPopover } from "./event-edit-popover";

interface GoogleCalendarEventProps {
  accountId: string;
  calendarId: string;
  /** Column index for horizontal positioning (0, 1, or 2) */
  columnIndex?: number;
  /** How many consecutive columns this item spans */
  columnSpan?: number;
  end: Temporal.ZonedDateTime;
  event: GoogleEvent;
  start: Temporal.ZonedDateTime;
  /** Total columns in this item's collision group */
  totalColumns?: number;
  /** Z-index for stacking order */
  zIndex?: number;
}

export const GoogleCalendarEvent = memo(function GoogleCalendarEventInner({
  event,
  start,
  end,
  accountId,
  calendarId,
  columnIndex = 0,
  totalColumns = 1,
  columnSpan = 1,
  zIndex = 1,
}: GoogleCalendarEventProps) {
  const queryClient = useQueryClient();

  // Prefetch the recurring master in the background so opening the popover is instant.
  const shouldPrefetchMaster = Boolean(event.recurringEventId);
  useEffect(() => {
    if (!(shouldPrefetchMaster && event.recurringEventId)) {
      return;
    }
    queryClient
      .prefetchQuery(
        recurringEventMasterQueryOptions({
          accountId,
          calendarId,
          recurringEventId: event.recurringEventId,
        })
      )
      .catch((_error) => null);
  }, [
    accountId,
    calendarId,
    event.recurringEventId,
    queryClient,
    shouldPrefetchMaster,
  ]);

  const durationMinutes = Math.max(
    1,
    Math.round(end.since(start).total({ unit: "minutes" }))
  );

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `google-event-${calendarId}-${event.id}`,
    data: {
      type: "google-event",
      event,
      accountId,
      calendarId,
      start,
      end,
    },
  });

  const {
    attributes: startAttributes,
    listeners: startListeners,
    setNodeRef: setStartHandleRef,
  } = useDraggable({
    id: `google-event-${calendarId}-${event.id}-resize-start`,
    data: {
      type: "google-event-resize",
      event,
      accountId,
      calendarId,
      start,
      end,
      direction: "start",
    },
  });

  const {
    attributes: endAttributes,
    listeners: endListeners,
    setNodeRef: setEndHandleRef,
  } = useDraggable({
    id: `google-event-${calendarId}-${event.id}-resize-end`,
    data: {
      type: "google-event-resize",
      event,
      accountId,
      calendarId,
      start,
      end,
      direction: "end",
    },
  });

  const { top, height } = calculateEventPosition(start, durationMinutes);

  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(accountId)
  );
  const calendars = useAtomValue(googleCalendarsDataAtom);

  // Find the calendar this event belongs to, for fallback colors
  const calendar = calendars.find(
    (c) => c.accountId === accountId && c.calendar.id === calendarId
  );

  const { background: backgroundColor, foreground: foregroundColor } =
    resolveGoogleEventColors({
      colorId: event.colorId,
      palette: normalizedPalette?.event,
      calendarBackgroundColor: calendar?.calendar.backgroundColor,
      calendarForegroundColor: calendar?.calendar.foregroundColor,
    });

  // Calculate horizontal positioning based on collision layout
  // columnSpan lets items expand into adjacent empty columns
  const singleColumnWidth = 100 / totalColumns;
  const columnWidth = singleColumnWidth * columnSpan;
  const leftPercent = columnIndex * singleColumnWidth;

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    height,
    // Horizontal positioning: divide available width by totalColumns
    left: `calc(${leftPercent}% + 2px)`,
    width: `calc(${columnWidth}% - 4px)`,
    zIndex,
  };

  const fillStyle: React.CSSProperties = {
    backgroundColor: backgroundColor ?? "hsl(var(--primary))",
    color: foregroundColor ?? "hsl(var(--primary-foreground))",
  };

  return (
    <EventEditPopover
      accountId={accountId}
      calendarId={calendarId}
      end={zonedDateTimeToDate(end)}
      event={event}
      start={zonedDateTimeToDate(start)}
    >
      <div
        className={cn(
          "group pointer-events-auto cursor-grab rounded-md bg-background p-px shadow-sm transition-shadow",
          "relative",
          "hover:shadow-md",
          isDragging ? "opacity-0" : ""
        )}
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
      >
        <div
          className="h-full rounded-[5px] border border-black/20 px-2 py-1 dark:border-white/30"
          style={fillStyle}
        >
          <div className="truncate font-medium text-xs">
            {event.summary ?? "Google event"}
          </div>
          {/* Hide time for short events (<30min) to prevent overflow */}
          {durationMinutes >= 30 && (
            <div className="truncate text-[10px] opacity-85">
              {formatTime(start)} - {formatTime(end)}
            </div>
          )}
        </div>
        <div
          className="absolute inset-x-0 -top-1 h-3 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
          ref={setStartHandleRef}
          {...startAttributes}
          {...startListeners}
        />
        <div
          className="absolute inset-x-0 -bottom-1 h-3 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
          ref={setEndHandleRef}
          {...endAttributes}
          {...endListeners}
        />
      </div>
    </EventEditPopover>
  );
});

export const GoogleCalendarEventPreview = memo(
  function GoogleCalendarEventPreviewInner({
    event,
    start,
    accountId,
    calendarId,
  }: {
    event: GoogleEvent;
    start: Temporal.ZonedDateTime;
    accountId: string;
    calendarId: string;
  }) {
    const normalizedPalette = useAtomValue(
      normalizedGoogleColorsAtomFamily(accountId)
    );
    const calendars = useAtomValue(googleCalendarsDataAtom);
    const calendar = calendars.find(
      (c) => c.accountId === accountId && c.calendar.id === calendarId
    );
    const { background: backgroundColor, foreground: foregroundColor } =
      resolveGoogleEventColors({
        colorId: event.colorId,
        palette: normalizedPalette?.event,
        calendarBackgroundColor: calendar?.calendar.backgroundColor,
        calendarForegroundColor: calendar?.calendar.foregroundColor,
      });

    const fillStyle: React.CSSProperties = {
      backgroundColor: backgroundColor ?? "hsl(var(--primary))",
      color: foregroundColor ?? "hsl(var(--primary-foreground))",
    };

    return (
      <div className="w-48 cursor-grabbing rounded-md bg-background p-px shadow-lg">
        <div
          className="rounded-[5px] border border-black/20 px-2 py-1 dark:border-white/30"
          style={fillStyle}
        >
          <div className="truncate font-medium text-xs">
            {event.summary ?? "Google event"}
          </div>
          <div className="truncate text-[10px] opacity-80">
            {formatTime(start)}
          </div>
        </div>
      </div>
    );
  }
);
