"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { format } from "date-fns";
import { GripVertical } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

type TaskItemProps = {
  /** The task to display */
  task: TaskSelect;
};

/**
 * TaskItem - A draggable task item in the sidebar.
 * Can be dragged onto the calendar to schedule the task.
 */
export const TaskItem = memo(function TaskItemInner({ task }: TaskItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: {
      type: "task",
      task,
    },
  });

  // Show if task is already scheduled
  const isScheduled = task.startTime !== null;

  return (
    <div
      className={cn(
        "group flex cursor-grab items-start gap-2 border-b p-4 text-sm leading-tight transition-colors last:border-b-0",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        // Hide original when dragging - DragOverlay shows the preview
        isDragging ? "opacity-0" : "",
        isScheduled ? "opacity-60" : ""
      )}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
    >
      {/* Drag handle indicator */}
      <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex w-full items-center gap-2">
          <span className="truncate">{task.title}</span>
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">
            {task.dueDate ? format(new Date(task.dueDate), "MMM d") : ""}
          </span>
        </div>
        {task.description ? (
          <span className="line-clamp-2 whitespace-break-spaces text-muted-foreground text-xs">
            {task.description}
          </span>
        ) : null}
        {/** biome-ignore lint/nursery/noLeakedRender: task.startTime is not null */}
        {isScheduled && task.startTime ? (
          <span className="text-[10px] text-primary">
            Scheduled: {format(new Date(task.startTime), "EEE h:mm a")}
          </span>
        ) : null}
      </div>
    </div>
  );
});

/**
 * TaskItemPreview - Used in DragOverlay for drag preview.
 */
export function TaskItemPreview({ task }: { task: TaskSelect }) {
  return (
    <div className="w-64 cursor-grabbing rounded-md border bg-sidebar p-3 shadow-lg">
      <div className="truncate font-medium text-sm">{task.title}</div>
      {task.description ? (
        <div className="mt-1 line-clamp-1 text-muted-foreground text-xs">
          {task.description}
        </div>
      ) : null}
    </div>
  );
}
