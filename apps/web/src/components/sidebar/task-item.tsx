"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { useAtomValue } from "jotai";
import { CalendarClock, CalendarDays, Clock } from "lucide-react";
import { memo, useCallback } from "react";
import { timezoneAtom } from "@/atoms/current-date";
import { useTaskMutations } from "@/hooks/use-update-task-mutation";
import { formatDateString, formatTimestampString } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../task-form/task-edit-popover";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";

type TaskItemProps = {
  /** The task to display */
  task: TaskSelect;
};

/**
 * Formats duration in minutes to a human-readable string.
 * e.g., 30 -> "30m", 90 -> "1h 30m", 120 -> "2h"
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * TaskItem - A draggable task item in the sidebar.
 * Can be dragged onto the calendar to schedule the task.
 */
export const TaskItem = memo(function TaskItemInner({ task }: TaskItemProps) {
  const timeZone = useAtomValue(timezoneAtom);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: {
      type: "task",
      task,
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

  // Show if task is already scheduled
  const isScheduled = task.startTime !== null;
  const isDone = task.status === "done";

  return (
    <TaskEditPopover task={task}>
      <div
        className={cn(
          "group flex cursor-grab items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          // Hide original when dragging - DragOverlay shows the preview
          isDragging ? "opacity-0" : "",
          isScheduled ? "opacity-60" : ""
        )}
        ref={setNodeRef}
        {...attributes}
        {...listeners}
      >
        {/* Status checkbox */}
        <Checkbox
          checked={isDone}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-full border-muted-foreground/50 transition-colors group-hover:border-foreground"
          onClick={handleStatusToggle}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Task title */}
          <span
            className={cn(
              "font-medium text-sm leading-tight",
              isDone ? "text-muted-foreground line-through" : ""
            )}
          >
            {task.title}
          </span>

          {/* Metadata badges row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Duration badge */}
            <Badge className="h-5 gap-1 px-1.5 text-[10px]" variant="secondary">
              <Clock className="size-3" />
              {formatDuration(task.durationMinutes)}
            </Badge>

            {/* Due date badge */}
            {task.dueDate ? (
              <Badge className="h-5 gap-1 px-1.5 text-[10px]" variant="outline">
                <CalendarDays className="size-3" />
                {formatDateString(task.dueDate)}
              </Badge>
            ) : null}

            {/* Scheduled time badge */}
            {task.startTime ? (
              <Badge className="h-5 gap-1 px-1.5 text-[10px]" variant="default">
                <CalendarClock className="size-3" />
                {formatTimestampString(task.startTime, timeZone)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </TaskEditPopover>
  );
});

/**
 * TaskItemPreview - Used in DragOverlay for drag preview.
 */
export function TaskItemPreview({ task }: { task: TaskSelect }) {
  return (
    <div className="w-64 cursor-grabbing rounded-md border bg-sidebar p-3 shadow-lg">
      <div className="truncate font-medium text-sm">{task.title}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Badge className="h-5 gap-1 px-1.5 text-[10px]" variant="secondary">
          <Clock className="size-3" />
          {formatDuration(task.durationMinutes)}
        </Badge>
      </div>
    </div>
  );
}
