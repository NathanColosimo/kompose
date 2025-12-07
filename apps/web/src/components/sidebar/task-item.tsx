"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { GripVertical } from "lucide-react";
import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";
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
  const queryClient = useQueryClient();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: {
      type: "task",
      task,
    },
  });

  const updateTaskMutation = useMutation({
    ...orpc.tasks.update.mutationOptions(),
    onMutate: async ({ id, task: taskUpdate }) => {
      await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });
      const previousTasks = queryClient.getQueryData<TaskSelect[]>(
        orpc.tasks.list.queryKey()
      );
      queryClient.setQueryData<TaskSelect[]>(
        orpc.tasks.list.queryKey(),
        (old) =>
          old?.map((t) =>
            t.id === id ? { ...t, ...taskUpdate, updatedAt: new Date() } : t
          )
      );
      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(
          orpc.tasks.list.queryKey(),
          context.previousTasks
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
    },
  });

  const handleStatusToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const newStatus = task.status === "done" ? "todo" : "done";
      updateTaskMutation.mutate({
        id: task.id,
        task: { status: newStatus },
      });
    },
    [task.id, task.status, updateTaskMutation]
  );

  // Show if task is already scheduled
  const isScheduled = task.startTime !== null;
  const isDone = task.status === "done";

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
      {/* Status checkbox */}
      <Checkbox
        checked={isDone}
        className="mt-0.5 size-3.5 shrink-0"
        onClick={handleStatusToggle}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex w-full items-center gap-2">
          <span className={cn("truncate", isDone && "text-muted-foreground line-through")}>
            {task.title}
          </span>
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
