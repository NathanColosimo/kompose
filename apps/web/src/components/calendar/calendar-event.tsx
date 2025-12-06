"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { format } from "date-fns";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { calculateEventPosition } from "./week-view";

type CalendarEventProps = {
  /** The scheduled task to display */
  task: TaskSelect;
};

/**
 * CalendarEvent - A draggable time block representing a scheduled task.
 * Positioned absolutely within its DayColumn based on start/end times.
 */
export const CalendarEvent = memo(function CalendarEventInner({
  task,
}: CalendarEventProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `event-${task.id}`,
    data: {
      type: "task",
      task,
    },
  });
  // Dedicated handles for resizing without affecting drag-to-move behavior
  const {
    attributes: startAttributes,
    listeners: startListeners,
    setNodeRef: setStartHandleRef,
  } = useDraggable({
    id: `event-${task.id}-resize-start`,
    data: {
      type: "task-resize",
      task,
      direction: "start",
    },
  });
  const {
    attributes: endAttributes,
    listeners: endListeners,
    setNodeRef: setEndHandleRef,
  } = useDraggable({
    id: `event-${task.id}-resize-end`,
    data: {
      type: "task-resize",
      task,
      direction: "end",
    },
  });

  // Calculate position based on start and end times
  if (!task.startTime) {
    return null;
  }

  const startTime = new Date(task.startTime);
  const durationMinutes = task.durationMinutes;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const { top, height } = calculateEventPosition(startTime, durationMinutes);

  // Position style (no transform - DragOverlay handles the moving preview)
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
        // Hide original when dragging - DragOverlay shows the preview
        isDragging ? "opacity-0" : ""
      )}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <div
        className="absolute inset-x-1 top-0 h-2 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
        ref={setStartHandleRef}
        {...startAttributes}
        {...startListeners}
      />
      <div
        className="absolute inset-x-1 bottom-0 h-2 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
        ref={setEndHandleRef}
        {...endAttributes}
        {...endListeners}
      />
      <div className="truncate font-medium text-xs">{task.title}</div>
      <div className="truncate text-[10px] opacity-80">
        {format(startTime, "h:mm a")} - {format(endTime, "h:mm a")}
      </div>
    </div>
  );
});

/**
 * CalendarEventPreview - Drag overlay preview for a task being dragged.
 * Used in DragOverlay for smooth visual feedback.
 */
export function CalendarEventPreview({ task }: { task: TaskSelect }) {
  return (
    <div className="w-48 cursor-grabbing rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-lg">
      <div className="truncate font-medium text-xs">{task.title}</div>
      {task.startTime ? (
        <div className="truncate text-[10px] opacity-80">
          {format(new Date(task.startTime), "h:mm a")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * GoogleCalendarEvent - Non-draggable block for Google Calendar events.
 * Uses the same positioning helper as tasks but stays pointer-passive for DnD.
 */
export const GoogleCalendarEvent = memo(function GoogleCalendarEventMemo({
  event,
  start,
  end,
  accountId,
  calendarId,
}: {
  event: GoogleEvent;
  start: Date;
  end: Date;
  accountId: string;
  calendarId: string;
}) {
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
        "pointer-events-auto cursor-grab rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-sm transition-shadow",
        "hover:shadow-md",
        isDragging ? "opacity-0" : ""
      )}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
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
  function GoogleCalendarEventPreviewMemo({
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
