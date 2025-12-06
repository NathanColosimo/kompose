"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { orpc } from "@/utils/orpc";
import { PIXELS_PER_HOUR } from "./constants";
import {
  buildGoogleMoveUpdate,
  buildGoogleResizeUpdate,
  buildTaskMoveUpdate,
  buildTaskResizeUpdate,
} from "./dnd/drop-handlers";
import {
  clampResizeEnd,
  clampResizeStart,
  durationInMinutes,
  isSameDayLocal,
  MINUTES_STEP,
  MS_PER_MINUTE,
  shiftMinutes,
} from "./dnd/helpers";
import type { DragData, PreviewRect, SlotData } from "./dnd/types";
import { GoogleCalendarEventPreview } from "./events/google-event";
import { TaskEventPreview } from "./events/task-event";
import { parseSlotId } from "./time-grid/slot-utils";

type CalendarDndProviderProps = {
  children: React.ReactNode;
};

/**
 * CalendarDndProvider - Wraps the calendar and sidebar with DnD context.
 * Handles drag events and task scheduling mutations.
 */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const [activeTask, setActiveTask] = useState<TaskSelect | null>(null);
  const [activeGoogleEvent, setActiveGoogleEvent] = useState<Extract<
    DragData,
    { type: "google-event" | "google-event-resize" }
  > | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [previewRect, setPreviewRect] = useState<PreviewRect | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<PreviewRect | null>(null);
  const queryClient = useQueryClient();
  const stableChildren = useMemo(() => children, [children]);

  // Configure sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance to prevent accidental drags
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Mutation to update task schedule
  const updateTaskMutation = useMutation({
    ...orpc.tasks.update.mutationOptions(),
    onMutate: async ({ id, task }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });

      // Snapshot previous value
      const previousTasks = queryClient.getQueryData<TaskSelect[]>(
        orpc.tasks.list.queryKey()
      );

      // Optimistically update
      queryClient.setQueryData<TaskSelect[]>(
        orpc.tasks.list.queryKey(),
        (old) =>
          old?.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...task,
                  updatedAt: new Date(),
                }
              : t
          )
      );

      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        queryClient.setQueryData(
          orpc.tasks.list.queryKey(),
          context.previousTasks
        );
      }
    },
    onSettled: () => {
      // Refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
    },
  });

  const updateGoogleEventMutation = useMutation({
    ...orpc.googleCal.events.update.mutationOptions(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orpc.googleCal.events.key() });
    },
  });

  const slotDataToDate = useCallback((slot: SlotData) => {
    const dateTime = new Date(slot.date);
    dateTime.setHours(slot.hour, slot.minutes, 0, 0);
    return dateTime;
  }, []);

  const clearPreview = useCallback(() => {
    pendingPreviewRef.current = null;
    setPreviewRect(null);
  }, []);

  const resetDragState = useCallback(() => {
    setActiveTask(null);
    setActiveGoogleEvent(null);
    setIsResizing(false);
    clearPreview();
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, [clearPreview]);

  const handleTaskMoveDrop = useCallback(
    (task: TaskSelect, startTime: Date) => {
      const update = buildTaskMoveUpdate(task, startTime);
      updateTaskMutation.mutate(update);
    },
    [updateTaskMutation]
  );

  const handleTaskResizeDrop = useCallback(
    (payload: {
      task: TaskSelect;
      targetDateTime: Date;
      direction: "start" | "end";
    }) => {
      const update = buildTaskResizeUpdate(payload);
      if (!update) {
        return;
      }

      updateTaskMutation.mutate(update);
    },
    [updateTaskMutation]
  );

  const handleGoogleEventDrop = useCallback(
    (data: Extract<DragData, { type: "google-event" }>, start: Date) => {
      const update = buildGoogleMoveUpdate(data, start);
      updateGoogleEventMutation.mutate(update);
    },
    [updateGoogleEventMutation]
  );

  const handleGoogleEventResizeDrop = useCallback(
    ({
      data,
      targetDateTime,
    }: {
      data: Extract<DragData, { type: "google-event-resize" }>;
      targetDateTime: Date;
    }) => {
      const update = buildGoogleResizeUpdate({ data, targetDateTime });
      if (!update) {
        return;
      }

      updateGoogleEventMutation.mutate(update);
    },
    [updateGoogleEventMutation]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData | undefined;

    if ((data?.type === "task" || data?.type === "task-resize") && data.task) {
      setActiveTask(data.task);
      setActiveGoogleEvent(null);
      setIsResizing(data.type === "task-resize");
      return;
    }

    if (data?.type === "google-event" || data?.type === "google-event-resize") {
      setActiveGoogleEvent(data);
      setActiveTask(null);
      setIsResizing(data.type === "google-event-resize");
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      resetDragState();

      if (!over) {
        return;
      }

      const overId = String(over.id);
      if (!overId.startsWith("slot-")) {
        return;
      }

      const targetDateTime = parseSlotId(overId);
      if (!targetDateTime) {
        return;
      }

      const data = active.data.current as DragData | undefined;
      if (!data) {
        return;
      }

      const isResizeEnd =
        (data.type === "task-resize" || data.type === "google-event-resize") &&
        data.direction === "end";
      const targetDateTimeAdjusted = isResizeEnd
        ? shiftMinutes(targetDateTime, MINUTES_STEP)
        : targetDateTime;

      switch (data.type) {
        case "task":
          handleTaskMoveDrop(data.task, targetDateTime);
          return;
        case "task-resize":
          handleTaskResizeDrop({
            task: data.task,
            targetDateTime: targetDateTimeAdjusted,
            direction: data.direction,
          });
          return;
        case "google-event":
          handleGoogleEventDrop(data, targetDateTime);
          return;
        case "google-event-resize":
          handleGoogleEventResizeDrop({
            data,
            targetDateTime: targetDateTimeAdjusted,
          });
          return;
        default:
          return;
      }
    },
    [
      handleGoogleEventDrop,
      handleGoogleEventResizeDrop,
      handleTaskMoveDrop,
      handleTaskResizeDrop,
      resetDragState,
    ]
  );

  const handleDragCancel = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

  const buildPreviewRect = useCallback(
    ({
      start,
      end,
      columnTop,
      overRect,
      minimum = MINUTES_STEP,
    }: {
      start: Date;
      end: Date;
      columnTop: number;
      overRect: Pick<PreviewRect, "left" | "width">;
      minimum?: number;
    }): PreviewRect => {
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const durationMinutes = durationInMinutes(start, end, minimum);
      const height = Math.max((durationMinutes / 60) * PIXELS_PER_HOUR, 24);

      return {
        top: columnTop + (startMinutes / 60) * PIXELS_PER_HOUR,
        left: overRect.left,
        width: overRect.width,
        height,
      };
    },
    []
  );

  const previewTaskMove = useCallback(
    (
      data: Extract<DragData, { type: "task" }>,
      targetDateTime: Date,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ) => {
      const durationMinutes = data.task.durationMinutes;
      const end = new Date(
        targetDateTime.getTime() + durationMinutes * MS_PER_MINUTE
      );
      return buildPreviewRect({
        start: targetDateTime,
        end,
        columnTop,
        overRect,
      });
    },
    [buildPreviewRect]
  );

  const previewTaskResize = useCallback(
    (
      data: Extract<DragData, { type: "task-resize" }>,
      targetDateTime: Date,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      if (!data.task.startTime) {
        return null;
      }

      const originalStart = new Date(data.task.startTime);
      const originalEnd = new Date(
        originalStart.getTime() + data.task.durationMinutes * MS_PER_MINUTE
      );

      if (!isSameDayLocal(originalStart, targetDateTime)) {
        return null;
      }

      if (data.direction === "start") {
        const newStart = clampResizeStart(
          targetDateTime,
          originalStart,
          originalEnd
        );
        return buildPreviewRect({
          start: newStart,
          end: originalEnd,
          columnTop,
          overRect,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        start: originalStart,
        end: newEnd,
        columnTop,
        overRect,
      });
    },
    [buildPreviewRect]
  );

  const previewGoogleMove = useCallback(
    (
      data: Extract<DragData, { type: "google-event" }>,
      targetDateTime: Date,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ) => {
      const eventDurationMinutes = durationInMinutes(data.start, data.end, 1);
      const end = new Date(
        targetDateTime.getTime() + eventDurationMinutes * MS_PER_MINUTE
      );
      return buildPreviewRect({
        start: targetDateTime,
        end,
        columnTop,
        overRect,
        minimum: 1,
      });
    },
    [buildPreviewRect]
  );

  const previewGoogleResize = useCallback(
    (
      data: Extract<DragData, { type: "google-event-resize" }>,
      targetDateTime: Date,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      const originalStart = data.start;
      const originalEnd = data.end;

      if (!isSameDayLocal(originalStart, targetDateTime)) {
        return null;
      }

      if (data.direction === "start") {
        const newStart = clampResizeStart(
          targetDateTime,
          originalStart,
          originalEnd
        );
        return buildPreviewRect({
          start: newStart,
          end: originalEnd,
          columnTop,
          overRect,
          minimum: 1,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        start: originalStart,
        end: newEnd,
        columnTop,
        overRect,
        minimum: 1,
      });
    },
    [buildPreviewRect]
  );

  const computePreviewForDrag = useCallback(
    (
      data: DragData,
      targetDateTime: Date,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      const isResizeEnd =
        (data.type === "task-resize" || data.type === "google-event-resize") &&
        data.direction === "end";
      const effectiveTarget = isResizeEnd
        ? shiftMinutes(targetDateTime, MINUTES_STEP)
        : targetDateTime;

      switch (data.type) {
        case "task":
          return previewTaskMove(data, effectiveTarget, columnTop, overRect);
        case "task-resize":
          return previewTaskResize(data, effectiveTarget, columnTop, overRect);
        case "google-event":
          return previewGoogleMove(data, effectiveTarget, columnTop, overRect);
        case "google-event-resize":
          return previewGoogleResize(
            data,
            effectiveTarget,
            columnTop,
            overRect
          );
        default:
          return null;
      }
    },
    [previewGoogleMove, previewGoogleResize, previewTaskMove, previewTaskResize]
  );

  const overlayContent = useMemo(() => {
    if (activeTask && !isResizing) {
      return (
        <TaskEventPreview
          key={`task-overlay-${activeTask.id}`}
          task={activeTask}
        />
      );
    }

    if (!activeTask && activeGoogleEvent && !isResizing) {
      return (
        <GoogleCalendarEventPreview
          event={activeGoogleEvent.event}
          key={`google-overlay-${activeGoogleEvent.event.id}`}
          start={activeGoogleEvent.start}
        />
      );
    }

    return null;
  }, [activeGoogleEvent, activeTask, isResizing]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;

      if (!(over && active)) {
        clearPreview();
        return;
      }

      const data = active.data.current as DragData | undefined;
      const overRect = over.rect;
      const slotData = over.data?.current as SlotData | undefined;

      if (!(overRect && data && slotData)) {
        clearPreview();
        return;
      }

      const targetDateTime = slotDataToDate(slotData);
      const minutesFromDayStart = slotData.hour * 60 + slotData.minutes;
      const columnTop =
        overRect.top - (minutesFromDayStart / 60) * PIXELS_PER_HOUR;

      pendingPreviewRef.current = computePreviewForDrag(
        data,
        targetDateTime,
        columnTop,
        { left: overRect.left, width: overRect.width }
      );

      if (previewFrameRef.current === null) {
        previewFrameRef.current = requestAnimationFrame(() => {
          previewFrameRef.current = null;
          setPreviewRect(pendingPreviewRef.current);
          pendingPreviewRef.current = null;
        });
      }
    },
    [clearPreview, computePreviewForDrag, slotDataToDate]
  );

  return (
    <DndContext
      autoScroll={false}
      collisionDetection={closestCenter}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      {stableChildren}

      {/* Drop preview outline showing the eventual placement and duration */}
      {previewRect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-30 rounded-md border-2 border-primary/70 bg-primary/10"
          style={{
            top: previewRect.top,
            left: previewRect.left,
            width: previewRect.width,
            height: previewRect.height,
          }}
        />
      ) : null}

      {/* Drag overlay for smooth preview during drag */}
      {overlayContent ? (
        <DragOverlay dropAnimation={null}>{overlayContent}</DragOverlay>
      ) : null}
    </DndContext>
  );
}
