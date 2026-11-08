"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import {
  timezoneAtom,
  todayPlainDateAtom,
} from "@kompose/state/atoms/current-date";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  formatDuration,
  formatScheduledAt,
} from "@kompose/state/temporal-utils";
import { useAtomValue } from "jotai";
import { CalendarClock, CalendarDays, Clock } from "lucide-react";
import { memo, useCallback } from "react";
import { Temporal } from "temporal-polyfill";
import { formatPlainDate } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { tagIconMap } from "../tags/tag-icon-map";
import { TaskEditPopover } from "../task-form/task-edit-popover";
import { Checkbox } from "../ui/checkbox";

interface TaskItemProps {
  /** A tag not to show, because the list is already that tag's. */
  hiddenTagId?: string;
  task: TaskSelectDecoded;
}

export const TaskItem = memo(function TaskItemInner({
  hiddenTagId,
  task,
}: TaskItemProps) {
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

  // The row drags (pointer only); its checkbox and the button that opens
  // the editor sit side by side, so neither control holds the other. The
  // button's ::after stretches over the row, so a click anywhere opens it,
  // and the button reaches the row's right edge, where the editor opens.
  return (
    <div
      className={cn(
        "group relative flex cursor-grab items-start gap-2.5 rounded-md py-2 pl-2 transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        // Hide original when dragging - DragOverlay shows the preview
        isDragging ? "opacity-0" : ""
      )}
      ref={setNodeRef}
      {...listeners}
    >
      <Checkbox
        aria-label={`Done: ${task.title}`}
        checked={isDone}
        className="z-10 mt-0.5 size-4 shrink-0 cursor-pointer rounded-full border-muted-foreground transition-colors group-hover:border-foreground"
        onClick={handleStatusToggle}
      />

      <TaskEditPopover surface="sidebar" task={task}>
        <button
          // The drag instructions ("Press Enter to open. Drag with a
          // pointer to move.").
          aria-describedby={attributes["aria-describedby"]}
          className="flex min-w-0 flex-1 cursor-grab flex-col gap-1 pr-2 text-left after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
          type="button"
        >
          <span
            className={cn(
              "text-sm leading-snug",
              isDone ? "text-muted-foreground line-through" : ""
            )}
          >
            {task.title}
          </span>

          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground text-xs tabular-nums">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatDuration(task.durationMinutes)}
            </span>

            {scheduledZdt ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3" />
                {formatScheduledAt(scheduledZdt, today)}
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
                {/* Tag and Inbox lists have no Overdue heading to say so. */}
                {isPastDue ? <span className="sr-only">(overdue)</span> : null}
              </span>
            ) : null}
            {task.tags
              .filter((tag) => tag.id !== hiddenTagId)
              .map((tag) => {
                const TagIcon = tagIconMap[tag.icon];
                return (
                  <span
                    className="flex min-w-0 max-w-full items-center gap-1 rounded-sm bg-foreground/[0.06] px-1.5 leading-5"
                    key={tag.id}
                  >
                    <TagIcon aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{tag.name}</span>
                  </span>
                );
              })}
          </span>
        </button>
      </TaskEditPopover>
    </div>
  );
});
