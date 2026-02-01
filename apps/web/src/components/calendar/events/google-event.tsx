"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  normalizedGoogleColorsAtomFamily,
  pastelizeColor,
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
  event: GoogleEvent;
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
  accountId: string;
  calendarId: string;
}

export const GoogleCalendarEvent = memo(function GoogleCalendarEventInner({
  event,
  start,
  end,
  accountId,
  calendarId,
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
  // Shrink block with equal inset on top and bottom to clarify boundaries.
  const rawTopPx = Number.parseFloat(top);
  const rawHeightPx = Number.parseFloat(height);
  const VERTICAL_SHRINK_PX = 4;
  const insetPx = VERTICAL_SHRINK_PX / 2;
  const adjustedTopPx = Number.isNaN(rawTopPx) ? 0 : rawTopPx + insetPx;
  const adjustedHeightPx = Math.max(
    (Number.isNaN(rawHeightPx) ? 0 : rawHeightPx) - VERTICAL_SHRINK_PX,
    20
  );

  const normalizedPalette = useAtomValue(
    normalizedGoogleColorsAtomFamily(accountId)
  );
  const calendars = useAtomValue(googleCalendarsDataAtom);

  // Look up the event's color from the palette if it has a colorId
  const eventPalette =
    event.colorId && normalizedPalette?.event
      ? normalizedPalette.event[event.colorId]
      : undefined;

  // Find the calendar this event belongs to, for fallback colors
  const calendar = calendars.find(
    (c) => c.accountId === accountId && c.calendar.id === calendarId
  );

  // Use event color if available, otherwise fall back to calendar's color (pastelized for consistency)
  const backgroundColor =
    eventPalette?.background ??
    pastelizeColor(calendar?.calendar.backgroundColor) ??
    undefined;
  const foregroundColor =
    eventPalette?.foreground ?? calendar?.calendar.foregroundColor ?? undefined;

  const style: React.CSSProperties = {
    position: "absolute",
    top: `${adjustedTopPx}px`,
    height: `${adjustedHeightPx}px`,
    left: "2px",
    right: "2px",
    ...(backgroundColor && {
      backgroundColor,
      borderColor: backgroundColor,
    }),
    ...(foregroundColor && { color: foregroundColor }),
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
          "group pointer-events-auto cursor-grab rounded-md border px-2 py-1 shadow-sm transition-shadow",
          backgroundColor
            ? ""
            : "border-primary/20 bg-primary/90 text-primary-foreground",
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
        <div className="truncate font-medium text-xs">
          {event.summary ?? "Google event"}
        </div>
        <div className="truncate text-[10px] opacity-85">
          {formatTime(start)} - {formatTime(end)}
        </div>
      </div>
    </EventEditPopover>
  );
});

export const GoogleCalendarEventPreview = memo(
  function GoogleCalendarEventPreviewInner({
    event,
    start,
  }: {
    event: GoogleEvent;
    start: Temporal.ZonedDateTime;
  }) {
    return (
      <div className="w-48 cursor-grabbing rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-lg">
        <div className="truncate font-medium text-xs">
          {event.summary ?? "Google event"}
        </div>
        <div className="truncate text-[10px] opacity-80">
          {formatTime(start)}
        </div>
      </div>
    );
  }
);
