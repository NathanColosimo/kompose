"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";
import { Checkbox } from "../../ui/checkbox";
import { calculateEventPosition } from "../week-view";

type TaskEventProps = {
  task: TaskSelect;
};

export const TaskEvent = memo(function TaskEventInner({
  task,
}: TaskEventProps) {
  const queryClient = useQueryClient();
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
          className="mt-0.5 size-3 shrink-0 border-primary-foreground/50 data-[state=checked]:border-primary-foreground/50 data-[state=checked]:bg-primary-foreground/20"
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
