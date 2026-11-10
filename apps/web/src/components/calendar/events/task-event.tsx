"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import type { ItemLayout } from "@kompose/state/collision-utils";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import type { Temporal } from "temporal-polyfill";
import { formatTime } from "@/lib/temporal-utils";
import { cn } from "@/lib/utils";
import { TaskEditPopover } from "../../task-form/task-edit-popover";
import { Checkbox } from "../../ui/checkbox";
import { PIXELS_PER_HOUR } from "../constants";
import {
  BLOCK_RAISE_CLASS,
  blockHorizontalStyle,
  blockStackStyle,
  calculateEventPosition,
} from "../event-position";

type ScheduledTask = TaskSelectDecoded & {
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime;
};

interface TaskEventProps {
  /** Whether this segment contains the task's actual start time */
  isFirstSegment: boolean;
  /** Whether this segment contains the task's actual end time */
  isLastSegment: boolean;
  layout?: ItemLayout;
  /** Clipped end time for this visible day segment */
  segmentEnd: Temporal.ZonedDateTime;
  /** Clipped start time for this visible day segment */
  segmentStart: Temporal.ZonedDateTime;
  task: ScheduledTask;
}

export const TaskEvent = memo(function TaskEventInner({
  layout,
  task,
  segmentStart,
  segmentEnd,
  isFirstSegment,
  isLastSegment,
}: TaskEventProps) {
  const timeZone = useAtomValue(timezoneAtom);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    data: {
      task,
      type: "task",
    },
    id: `event-${task.id}-${segmentStart.toString()}`,
  });

  const {
    attributes: startAttributes,
    listeners: startListeners,
    setNodeRef: setStartHandleRef,
  } = useDraggable({
    data: {
      direction: "start",
      task,
      type: "task-resize",
    },
    id: `event-${task.id}-resize-start`,
  });

  const {
    attributes: endAttributes,
    listeners: endListeners,
    setNodeRef: setEndHandleRef,
  } = useDraggable({
    data: {
      direction: "end",
      task,
      type: "task-resize",
    },
    id: `event-${task.id}-resize-end`,
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

  const durationMinutes = task.durationMinutes;
  const segmentDurationMinutes = Math.round(
    segmentEnd.since(segmentStart).total({ unit: "minutes" })
  );
  const taskStart = task.startDate.toZonedDateTime({
    plainTime: task.startTime,
    timeZone,
  });
  const taskEnd = taskStart.add({ minutes: durationMinutes });

  const { top, height } = calculateEventPosition(
    segmentStart,
    segmentDurationMinutes
  );
  const isDone = task.status === "done";
  const isShortTask = segmentDurationMinutes <= 15;

  const style: React.CSSProperties = {
    height,
    ...blockHorizontalStyle(layout),
    position: "absolute",
    top,
    ...blockStackStyle(layout?.zIndex),
  };

  return (
    <TaskEditPopover align="start" side="right" surface="calendar" task={task}>
      <div
        className={cn(
          "group pointer-events-auto cursor-grab rounded-md bg-background p-px shadow-sm transition-shadow",
          "relative",
          BLOCK_RAISE_CLASS,
          "hover:shadow-md",
          isDragging ? "opacity-0" : "",
          isDone ? "opacity-60" : ""
        )}
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
      >
        <div className="h-full rounded-[5px] border border-black/20 bg-primary/90 p-1 text-primary-foreground dark:border-white/30">
          <div
            className={cn(
              "flex h-full gap-1",
              isShortTask ? "items-center" : "items-start"
            )}
          >
            <Checkbox
              checked={isDone}
              className="size-3.5 shrink-0 cursor-pointer"
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
              {segmentDurationMinutes >= 30 && (
                <div className="truncate text-[10px] opacity-80">
                  {formatTime(taskStart)} - {formatTime(taskEnd)}
                </div>
              )}
            </div>
          </div>
        </div>
        {isFirstSegment ? (
          <div
            className="absolute inset-x-0 -top-1 h-3 cursor-n-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
            ref={setStartHandleRef}
            {...startAttributes}
            {...startListeners}
          />
        ) : null}
        {isLastSegment ? (
          <div
            className="absolute inset-x-0 -bottom-1 h-3 cursor-s-resize rounded-sm bg-primary/60 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-80"
            ref={setEndHandleRef}
            {...endAttributes}
            {...endListeners}
          />
        ) : null}
      </div>
    </TaskEditPopover>
  );
});

export function TaskEventPreview({ task }: { task: TaskSelectDecoded }) {
  const timeZone = useAtomValue(timezoneAtom);
  const isShortTask = task.durationMinutes <= 15;
  const shortTaskHeight = (15 / 60) * PIXELS_PER_HOUR;

  const startZdt =
    task.startDate && task.startTime
      ? task.startDate.toZonedDateTime({ plainTime: task.startTime, timeZone })
      : null;

  return (
    <div
      className="w-48 cursor-grabbing rounded-md bg-background p-px shadow-lg"
      style={isShortTask ? { height: shortTaskHeight } : undefined}
    >
      <div
        className={cn(
          "rounded-[5px] border border-black/20 bg-primary/90 p-1 text-primary-foreground dark:border-white/30",
          isShortTask ? "flex h-full items-center px-1.5 py-0" : ""
        )}
      >
        <div className="truncate font-medium text-xs">{task.title}</div>
        {startZdt && !isShortTask ? (
          <div className="truncate text-[10px] opacity-80">
            {formatTime(startZdt)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
