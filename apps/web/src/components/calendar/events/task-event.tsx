"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import { formatTime } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../../task-form/task-edit-popover";
import { Checkbox } from "../../ui/checkbox";
import { calculateEventPosition } from "../days-view";

interface TaskEventProps {
  task: TaskSelectDecoded;
  /** Column index for horizontal positioning (0, 1, or 2) */
  columnIndex?: number;
  /** Total columns in this item's collision group */
  totalColumns?: number;
  /** Z-index for stacking order */
  zIndex?: number;
}

export const TaskEvent = memo(function TaskEventInner({
  task,
  columnIndex = 0,
  totalColumns = 1,
  zIndex = 1,
}: TaskEventProps) {
  const timeZone = useAtomValue(timezoneAtom);

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

  const { updateTask } = useTasks();

  const handleStatusToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const newStatus = task.status === "done" ? "todo" : "done";
      updateTask.mutate({
        id: task.id,
        task: { status: newStatus },
        scope: "this",
      });
    },
    [task.id, task.status, updateTask]
  );

  // Need both startDate and startTime to display on calendar
  if (!(task.startDate && task.startTime)) {
    return null;
  }

  // Validate durationMinutes before use
  const durationMinutes = task.durationMinutes;
  if (durationMinutes <= 0) {
    return null;
  }

  // Combine startDate + startTime into ZonedDateTime
  const startZdt = task.startDate.toZonedDateTime({
    timeZone,
    plainTime: task.startTime,
  });
  const endZdt = startZdt.add({ minutes: durationMinutes });

  const { top, height } = calculateEventPosition(startZdt, durationMinutes);
  const isDone = task.status === "done";

  // Calculate horizontal positioning based on collision layout
  const columnWidth = 100 / totalColumns;
  const leftPercent = columnIndex * columnWidth;

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    height,
    // Horizontal positioning: divide available width by totalColumns
    left: `calc(${leftPercent}% + 2px)`,
    width: `calc(${columnWidth}% - 4px)`,
    zIndex,
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
          className="absolute inset-x-0 -top-1 h-3 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
          ref={setStartHandleRef}
          {...startAttributes}
          {...startListeners}
        />
        <div
          className="absolute inset-x-0 -bottom-1 h-3 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
          ref={setEndHandleRef}
          {...endAttributes}
          {...endListeners}
        />
        <div className="flex items-start gap-1">
          <Checkbox
            checked={isDone}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer"
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
            {/* Hide time for short events (<30min) to prevent overflow */}
            {durationMinutes >= 30 && (
              <div className="truncate text-[10px] opacity-80">
                {formatTime(startZdt)} - {formatTime(endZdt)}
              </div>
            )}
          </div>
        </div>
      </div>
    </TaskEditPopover>
  );
});

export function TaskEventPreview({ task }: { task: TaskSelectDecoded }) {
  const timeZone = useAtomValue(timezoneAtom);

  // Combine startDate + startTime if both exist for time display
  const startZdt =
    task.startDate && task.startTime
      ? task.startDate.toZonedDateTime({ timeZone, plainTime: task.startTime })
      : null;

  return (
    <div className="w-48 cursor-grabbing rounded-md border border-primary/20 bg-primary/90 px-2 py-1 text-primary-foreground shadow-lg">
      <div className="truncate font-medium text-xs">{task.title}</div>
      {startZdt ? (
        <div className="truncate text-[10px] opacity-80">
          {formatTime(startZdt)}
        </div>
      ) : null}
    </div>
  );
}
