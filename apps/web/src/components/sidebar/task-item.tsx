"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  timezoneAtom,
  todayPlainDateAtom,
} from "@kompose/state/atoms/current-date";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtomValue } from "jotai";
import { CalendarClock, CalendarDays, Clock } from "lucide-react";
import { memo, useCallback } from "react";
import { Temporal } from "temporal-polyfill";
import {
  formatDuration,
  formatPlainDate,
  formatTime,
} from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../task-form/task-edit-popover";
import { Checkbox } from "../ui/checkbox";

interface TaskItemProps {
  task: TaskSelectDecoded;
}

export const TaskItem = memo(function TaskItemInner({ task }: TaskItemProps) {
  const timeZone = useAtomValue(timezoneAtom);
  const today = useAtomValue(todayPlainDateAtom);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    data: {
      task,
      type: "task",
    },
    id: `task-${task.id}`,
  });

  const { updateTask } = useTasks();

  const handleStatusToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const newStatus = task.status === "done" ? "todo" : "done";
      updateTask.mutate({
        id: task.id,
        scope: "this",
        task: { status: newStatus },
      });
    },
    [task.id, task.status, updateTask]
  );

  const scheduledZdt =
    task.startDate && task.startTime
      ? task.startDate.toZonedDateTime({ plainTime: task.startTime, timeZone })
      : null;

  const isDone = task.status === "done";
  const isPastDue =
    !isDone &&
    task.dueDate !== null &&
    Temporal.PlainDate.compare(task.dueDate, today) < 0;

  return (
    <TaskEditPopover surface="sidebar" task={task}>
      <div
        className={cn(
          "group flex cursor-grab items-start gap-2.5 rounded-md px-2 py-2 transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          // Hide original when dragging - DragOverlay shows the preview
          isDragging ? "opacity-0" : ""
        )}
        ref={setNodeRef}
        {...attributes}
        {...listeners}
      >
        <Checkbox
          checked={isDone}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-full border-muted-foreground/50 transition-colors group-hover:border-foreground"
          onClick={handleStatusToggle}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "text-sm leading-snug",
              isDone ? "text-muted-foreground line-through" : ""
            )}
          >
            {task.title}
          </span>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs tabular-nums">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatDuration(task.durationMinutes)}
            </span>

            {scheduledZdt ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3" />
                {formatTime(scheduledZdt, {
                  hour: "numeric",
                  minute: "2-digit",
                  weekday: "short",
                })}
              </span>
            ) : null}

            {task.dueDate ? (
              <span
                className={cn(
                  "flex items-center gap-1",
                  isPastDue ? "text-destructive" : ""
                )}
              >
                <CalendarDays className="size-3" />
                Due{" "}
                {formatPlainDate(task.dueDate, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </TaskEditPopover>
  );
});
