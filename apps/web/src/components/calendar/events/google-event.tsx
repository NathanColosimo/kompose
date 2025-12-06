"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { format } from "date-fns";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { calculateEventPosition } from "../week-view";

type GoogleCalendarEventProps = {
  event: GoogleEvent;
  start: Date;
  end: Date;
  accountId: string;
  calendarId: string;
};

export const GoogleCalendarEvent = memo(function GoogleCalendarEventInner({
  event,
  start,
  end,
  accountId,
  calendarId,
}: GoogleCalendarEventProps) {
  const durationMinutes = Math.max(
    1,
    (end.getTime() - start.getTime()) / (60 * 1000)
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

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    height,
    left: "2px",
    right: "2px",
  };

  return (
    <div
      className={cn(
        "group pointer-events-auto cursor-grab rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-sm transition-shadow",
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
        className="-top-1 absolute inset-x-0 h-3 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
        ref={setStartHandleRef}
        {...startAttributes}
        {...startListeners}
      />
      <div
        className="-bottom-1 absolute inset-x-0 h-3 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
        ref={setEndHandleRef}
        {...endAttributes}
        {...endListeners}
      />
      <div className="truncate font-medium text-xs">
        {event.summary ?? "Google event"}
      </div>
      <div className="truncate text-[10px] opacity-85">
        {format(start, "h:mm a")} - {format(end, "h:mm a")}
      </div>
    </div>
  );
});

export const GoogleCalendarEventPreview = memo(
  function GoogleCalendarEventPreviewInner({
    event,
    start,
  }: {
    event: GoogleEvent;
    start: Date;
  }) {
    return (
      <div className="w-48 cursor-grabbing rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-lg">
        <div className="truncate font-medium text-xs">
          {event.summary ?? "Google event"}
        </div>
        <div className="truncate text-[10px] opacity-80">
          {format(start, "h:mm a")}
        </div>
      </div>
    );
  }
);
