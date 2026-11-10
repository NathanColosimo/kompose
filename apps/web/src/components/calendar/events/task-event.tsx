"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import type { ItemLayout } from "@kompose/state/collision-utils";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { formatTimeRange } from "@kompose/state/temporal-utils";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import type { Temporal } from "temporal-polyfill";
import { cn } from "@/lib/utils";
import { tagIconMap } from "../../tags/tag-icon-map";
import { TaskEditPopover } from "../../task-form/task-edit-popover";
import { Checkbox } from "../../ui/checkbox";
import { PIXELS_PER_HOUR } from "../constants";
import { ownPresses } from "../dnd/helpers";
import { taskItemKey, useIsItemMoving } from "../dnd/moving-item";
import {
  BLOCK_RAISE_CLASS,
  blockHorizontalStyle,
  blockStackStyle,
  calculateEventPosition,
  GRIP_PROPS,
} from "../event-position";
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
  /** Whether this segment contains the task's actual start time */
  isFirstSegment: boolean;
  /** Whether this segment contains the task's actual end time */
  isLastSegment: boolean;
  /** Placement among overlapping items on its day. */
  layout?: ItemLayout;
  /** Clipped end time for this visible day segment */
  segmentEnd: Temporal.ZonedDateTime;
  /** Clipped start time for this visible day segment */
  segmentStart: Temporal.ZonedDateTime;
  task: ScheduledTask;
}

export const TaskEvent = memo(function TaskEventInner({
  task,
  segmentStart,
  segmentEnd,
  isFirstSegment,
  isLastSegment,
  layout,
}: TaskEventProps) {
  const taskStart = task.startDate.toZonedDateTime({
    plainTime: task.startTime,
    timeZone: segmentStart.timeZoneId,
  });
  // One per drawn day: dnd-kit keeps one node per id, so an overnight
  // task's two parts need their own.
  const dragId = `event-${task.id}-${segmentStart.toPlainDate()}`;
  const isMoving = useIsItemMoving(taskItemKey(task.id));
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    attributes: { roleDescription: "task" },
    data: {
      // Moving an overnight task's second-day part shifts the whole task.
      grabOffsetMinutes: segmentStart
        .since(taskStart)
        .total({ unit: "minutes" }),
      task,
      type: "task",
    },
    id: dragId,
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
    id: `${dragId}-resize-start`,
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
    id: `${dragId}-resize-end`,
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
  // Under 30 minutes visible, the block is one centered line.
  const isShort =
    Math.min(
      segmentDurationMinutes,
      layout?.uncoveredMinutes ?? segmentDurationMinutes
    ) < 30;
  const style: React.CSSProperties = {
    ...blockHorizontalStyle(layout),
    height,
    position: "absolute",
    top,
    ...blockStackStyle(layout?.zIndex),
  };

  return (
    // The block drags (pointer only); its checkbox and the button that
    // opens the editor sit side by side, so neither control holds the
    // other. The button's ::after stretches over the block, so a click
    // anywhere opens it, and it reaches the block's right edge, where the
    // editor opens.
    <div
      className={cn(
        "group pointer-events-auto relative cursor-grab rounded-md bg-background p-px",
        BLOCK_RAISE_CLASS,
        // The editor's trigger is the inner button, so raise on its state.
        "has-[:focus-visible]:z-50 has-[[data-state=open]]:z-50",
        isDragging || isMoving ? "opacity-0" : "",
        isDone ? "opacity-60" : ""
      )}
      ref={setNodeRef}
      style={style}
      title={`${task.title} · ${formatTimeRange(
        taskStart,
        taskStart.add({ minutes: task.durationMinutes })
      )}`}
      {...ownPresses(listeners)}
    >
      <div
        className={cn(
          "@container relative flex h-full gap-1.5 overflow-hidden rounded-[5px] border border-foreground/20 bg-card pr-1.5 pl-1.5 text-card-foreground dark:border-foreground/12",
          isShort ? "items-center py-0" : "items-start py-1"
        )}
      >
        {/* Narrow blocks give the checkbox's room to the title; the editor
            has Done too. */}
        <span
          className={cn(
            "relative z-10 flex @max-[5.5rem]:hidden shrink-0",
            isShort ? null : "mt-px"
          )}
        >
          <Checkbox
            aria-label={`Done: ${task.title}`}
            checked={isDone}
            className="size-3.5 cursor-pointer border-foreground/60"
            onClick={handleStatusToggle}
          />
        </span>
        <TaskEditPopover
          align="start"
          side="right"
          surface="calendar"
          task={task}
        >
          <button
            // A column, so its text starts at the top as in any block (a
            // button centers its content); a short block centers its own.
            // dnd-kit's drag instructions (set on DndContext).
            aria-describedby={attributes["aria-describedby"]}
            className="flex h-full min-w-0 flex-1 cursor-grab flex-col text-left after:absolute after:inset-0 after:rounded-[5px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
            type="button"
          >
            <BlockContent
              details={taskTagDetails(task)}
              end={segmentEnd}
              shownEnd={taskStart.add({ minutes: task.durationMinutes })}
              shownStart={taskStart}
              start={segmentStart}
              struck={isDone}
              title={task.title}
              uncoveredMinutes={layout?.uncoveredMinutes}
            />
          </button>
        </TaskEditPopover>
      </div>
      {isFirstSegment ? (
        <div
          className="absolute inset-x-0 -top-1 flex h-3 cursor-n-resize items-center justify-center opacity-0 transition-opacity after:h-1 after:w-6 after:rounded-full after:bg-foreground/45 after:content-[''] group-hover:opacity-100"
          ref={setStartHandleRef}
          {...startAttributes}
          {...startListeners}
          {...GRIP_PROPS}
        />
      ) : null}
      {isLastSegment ? (
        <div
          className="absolute inset-x-0 -bottom-1 flex h-3 cursor-s-resize items-center justify-center opacity-0 transition-opacity after:h-1 after:w-6 after:rounded-full after:bg-foreground/45 after:content-[''] group-hover:opacity-100"
          ref={setEndHandleRef}
          {...endAttributes}
          {...endListeners}
          {...GRIP_PROPS}
        />
      ) : null}
    </div>
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
