"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";
import { tagIconMap } from "../../tags/tag-icon-map";
import { TaskEditPopover } from "../../task-form/task-edit-popover";
import { Checkbox } from "../../ui/checkbox";
import { PIXELS_PER_HOUR } from "../constants";
import { calculateEventPosition } from "../event-position";
import { BlockContent, type BlockDetail } from "./block-content";

/** The task's first tag, plus a count of the rest. */
function taskTagDetails(task: TaskSelectDecoded): BlockDetail[] {
  const [first, ...rest] = task.tags;
  if (!first) {
    return [];
  }
  return [
    {
      icon: tagIconMap[first.icon],
      label: rest.length > 0 ? `${first.name} +${rest.length}` : first.name,
    },
  ];
}

type ScheduledTask = TaskSelectDecoded & {
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime;
};

interface TaskEventProps {
  columnIndex?: number;
  columnSpan?: number;
  /** Whether this segment contains the task's actual start time */
  isFirstSegment: boolean;
  /** Whether this segment contains the task's actual end time */
  isLastSegment: boolean;
  /** Clipped end time for this visible day segment */
  segmentEnd: Temporal.ZonedDateTime;
  /** Clipped start time for this visible day segment */
  segmentStart: Temporal.ZonedDateTime;
  task: ScheduledTask;
  totalColumns?: number;
  zIndex?: number;
}

export const TaskEvent = memo(function TaskEventInner({
  task,
  segmentStart,
  segmentEnd,
  isFirstSegment,
  isLastSegment,
  columnIndex = 0,
  totalColumns = 1,
  columnSpan = 1,
  zIndex = 1,
}: TaskEventProps) {
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

  const segmentDurationMinutes = Math.round(
    segmentEnd.since(segmentStart).total({ unit: "minutes" })
  );
  const { top, height } = calculateEventPosition(
    segmentStart,
    segmentDurationMinutes
  );
  const isDone = task.status === "done";
  // columnSpan lets items expand into adjacent empty columns
  const singleColumnWidth = 100 / totalColumns;
  const columnWidth = singleColumnWidth * columnSpan;
  const leftPercent = columnIndex * singleColumnWidth;

  const style: React.CSSProperties = {
    height,
    left: `calc(${leftPercent}% + 2px)`,
    position: "absolute",
    top,
    width: `calc(${columnWidth}% - 4px)`,
    zIndex,
  };

  return (
    <TaskEditPopover align="start" side="right" surface="calendar" task={task}>
      <div
        className={cn(
          "group pointer-events-auto cursor-grab rounded-md bg-background p-px transition-shadow",
          "relative",
          "hover:shadow-sm",
          isDragging ? "opacity-0" : "",
          isDone ? "opacity-60" : ""
        )}
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
      >
        <div
          className={cn(
            "h-full overflow-hidden rounded-[5px] border border-foreground/20 bg-card pr-1.5 pl-1.5 text-card-foreground dark:border-foreground/12",
            segmentDurationMinutes < 30 ? "py-0" : "py-1"
          )}
        >
          <BlockContent
            details={taskTagDetails(task)}
            end={segmentEnd}
            leading={
              <Checkbox
                aria-label={isDone ? "Mark as not done" : "Mark as done"}
                checked={isDone}
                className="mt-px size-3.5 shrink-0 cursor-pointer border-foreground/60"
                onClick={handleStatusToggle}
              />
            }
            start={segmentStart}
            struck={isDone}
            title={task.title}
          />
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
          "rounded-[5px] border border-foreground/20 bg-card px-1.5 text-card-foreground dark:border-foreground/12",
          isShortTask ? "h-full py-0" : "py-1"
        )}
      >
        {startZdt ? (
          <BlockContent
            end={startZdt.add({ minutes: task.durationMinutes })}
            start={startZdt}
            title={task.title}
          />
        ) : (
          <div className="truncate font-medium text-xs">{task.title}</div>
        )}
      </div>
    </div>
  );
}
