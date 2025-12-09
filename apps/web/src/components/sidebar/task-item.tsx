"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { format } from "date-fns";
import { memo, useCallback } from "react";
import { useTaskMutations } from "@/hooks/use-update-task-mutation";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../task-form/task-edit-popover";
import { Checkbox } from "../ui/checkbox";

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
        {/* Status checkbox */}
        <Checkbox
          checked={isDone}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer border-muted-foreground/70 bg-sidebar text-foreground transition-colors group-hover:border-foreground"
          onClick={handleStatusToggle}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex w-full items-center gap-2">
            <span
              className={cn(
                "truncate",
                isDone ? "text-muted-foreground line-through" : ""
              )}
            >
              {task.title}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground text-xs">
              {task.dueDate ? format(new Date(task.dueDate), "MMM d") : ""}
            </span>
          </div>
          {/** biome-ignore lint/nursery/noLeakedRender: task.startTime is not null */}
          {isScheduled && task.startTime ? (
            <span className="text-[10px] text-primary">
              Scheduled: {format(new Date(task.startTime), "EEE h:mm a")}
            </span>
          ) : null}
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
    </div>
  );
}
