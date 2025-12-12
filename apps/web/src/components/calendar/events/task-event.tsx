"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { format } from "date-fns";
import { memo, useCallback } from "react";
import { useTaskMutations } from "@/hooks/use-update-task-mutation";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../../task-form/task-edit-popover";
import { Checkbox } from "../../ui/checkbox";
import { calculateEventPosition } from "../days-view";

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

  const { updateTask } = useTaskMutations();

  const handleStatusToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const newStatus = task.status === "done" ? "todo" : "done";
      updateTask.mutate({
        id: task.id,
        task: { status: newStatus },
      });
    },
    [task.id, task.status, updateTask]
  );

  if (!task.startTime) {
    return null;
  }

  const startTime = new Date(task.startTime);
  const durationMinutes = task.durationMinutes;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const { top, height } = calculateEventPosition(startTime, durationMinutes);
  const isDone = task.status === "done";

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    height,
    left: "2px",
    right: "2px",
  };

  return (
    <TaskEditPopover align="start" side="right" task={task}>
      <div
        className={cn(
          "group pointer-events-auto cursor-grab rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-sm transition-shadow",
          "relative",
          "hover:shadow-md",
          isDragging ? "opacity-0" : "",
          isDone ? "opacity-60" : ""
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
        <div className="flex items-start gap-1">
          <Checkbox
            checked={isDone}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer"
            onClick={handleStatusToggle}
          />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "truncate font-medium text-xs",
                isDone ? "line-through opacity-80" : ""
              )}
            >
              {task.title}
            </div>
            <div className="truncate text-[10px] opacity-80">
              {format(startTime, "h:mm a")} - {format(endTime, "h:mm a")}
            </div>
          </div>
        </div>
      </div>
    </TaskEditPopover>
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
