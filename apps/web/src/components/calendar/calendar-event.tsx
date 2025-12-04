"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
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
      type: "event",
      task,
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
        "pointer-events-auto cursor-grab rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-sm transition-shadow",
        "hover:shadow-md",
        // Hide original when dragging - DragOverlay shows the preview
        isDragging ? "opacity-0" : ""
      )}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
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
