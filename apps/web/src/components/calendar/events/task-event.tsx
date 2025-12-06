"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { format } from "date-fns";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { calculateEventPosition } from "../week-view";

type TaskEventProps = {
  task: TaskSelect;
};

export const TaskEvent = memo(function TaskEventInner({
  task,
}: TaskEventProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `event-${task.id}`,
    data: {
      type: "task",
      task,
    },
  });

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

  if (!task.startTime) {
    return null;
  }

  const startTime = new Date(task.startTime);
  const durationMinutes = task.durationMinutes;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const { top, height } = calculateEventPosition(startTime, durationMinutes);

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

export function TaskEventPreview({ task }: { task: TaskSelect }) {
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
