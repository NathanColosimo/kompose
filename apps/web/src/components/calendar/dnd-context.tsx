"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Temporal } from "temporal-polyfill";
import { timezoneAtom } from "@/atoms/current-date";
import { SIDEBAR_TASK_LIST_DROPPABLE_ID } from "@/components/sidebar/sidebar-left";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGoogleEventMutations } from "@/hooks/use-google-event-mutations";
import { useTasks } from "@/hooks/use-tasks";
import { isSameDay, minutesFromMidnight } from "@/lib/temporal-utils";
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
  MINUTES_STEP,
} from "./dnd/helpers";
import type { DragData, PreviewRect, SlotData } from "./dnd/types";
import { GoogleCalendarEventPreview } from "./events/google-event";
import { TaskEventPreview } from "./events/task-event";

/** Pending task update waiting for scope selection */
interface PendingTaskUpdate {
  id: string;
  task: object;
}

interface CalendarDndProviderProps {
  children: React.ReactNode;
}

/**
 * CalendarDndProvider - Wraps the calendar and sidebar with DnD context.
 * Handles drag events and task scheduling mutations.
 */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const timeZone = useAtomValue(timezoneAtom);
  const [activeTask, setActiveTask] = useState<TaskSelectDecoded | null>(null);
  const [activeGoogleEvent, setActiveGoogleEvent] = useState<Extract<
    DragData,
    { type: "google-event" | "google-event-resize" }
  > | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [previewRect, setPreviewRect] = useState<PreviewRect | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<PreviewRect | null>(null);
  const stableChildren = useMemo(() => children, [children]);

  // State for pending recurring task updates that need scope selection
  const [pendingUpdate, setPendingUpdate] = useState<PendingTaskUpdate | null>(
    null
  );

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
  const { updateTask } = useTasks();
  const { updateEvent: updateGoogleEventMutation } = useGoogleEventMutations();

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
    (task: TaskSelectDecoded, startTime: Temporal.ZonedDateTime) => {
      const update = buildTaskMoveUpdate(task, startTime);

      // If recurring, show scope selection dialog
      if (task.seriesMasterId) {
        setPendingUpdate({ id: update.id, task: update.task });
        return;
      }

      updateTask.mutate(update);
    },
    [updateTask]
  );

  /**
   * Handle unscheduling a task by clearing startDate and startTime but keeping the duration.
   * Called when a task is dropped on the sidebar task list.
   */
  const handleTaskUnschedule = useCallback(
    (task: TaskSelectDecoded) => {
      updateTask.mutate({
        id: task.id,
        task: {
          startDate: null,
          startTime: null,
          durationMinutes: task.durationMinutes,
        },
        // Unscheduling affects just this occurrence
        scope: "this",
      });
    },
    [updateTask]
  );

  const handleTaskResizeDrop = useCallback(
    (payload: {
      task: TaskSelectDecoded;
      targetDateTime: Temporal.ZonedDateTime;
      direction: "start" | "end";
    }) => {
      const update = buildTaskResizeUpdate({
        ...payload,
        timeZone,
      });
      if (!update) {
        return;
      }

      // If recurring, show scope selection dialog
      if (payload.task.seriesMasterId) {
        setPendingUpdate({ id: update.id, task: update.task });
        return;
      }

      updateTask.mutate(update);
    },
    [updateTask, timeZone]
  );

  const handleGoogleEventDrop = useCallback(
    (
      data: Extract<DragData, { type: "google-event" }>,
      start: Temporal.ZonedDateTime
    ) => {
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
      targetDateTime: Temporal.ZonedDateTime;
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

  // Handle drops on the sidebar list by unscheduling task cards.
  const handleSidebarDrop = useCallback(
    (data: DragData) => {
      if (data.type !== "task") {
        return;
      }

      handleTaskUnschedule(data.task);
    },
    [handleTaskUnschedule]
  );

  // Route calendar slot drops to the correct drop handler based on drag type.
  const handleSlotDrop = useCallback(
    (data: DragData, slotData: SlotData) => {
      const targetDateTime = slotData.dateTime;

      const isResizeEnd =
        (data.type === "task-resize" || data.type === "google-event-resize") &&
        data.direction === "end";
      const targetDateTimeAdjusted = isResizeEnd
        ? targetDateTime.add({ minutes: MINUTES_STEP })
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
    ]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      resetDragState();

      if (!over) {
        return;
      }

      const overId = String(over.id);
      const data = active.data.current as DragData | undefined;
      if (!data) {
        return;
      }

      if (overId === SIDEBAR_TASK_LIST_DROPPABLE_ID) {
        handleSidebarDrop(data);
        return;
      }

      // Get slot data from droppable
      const slotData = over.data?.current as SlotData | undefined;
      if (!slotData?.dateTime) {
        return;
      }

      handleSlotDrop(data, slotData);
    },
    [handleSidebarDrop, handleSlotDrop, resetDragState]
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
      start: Temporal.ZonedDateTime;
      end: Temporal.ZonedDateTime;
      columnTop: number;
      overRect: Pick<PreviewRect, "left" | "width">;
      minimum?: number;
    }): PreviewRect => {
      const startMinutes = minutesFromMidnight(start);
      const duration = durationInMinutes(start, end, minimum);
      const height = Math.max((duration / 60) * PIXELS_PER_HOUR, 24);

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
      targetDateTime: Temporal.ZonedDateTime,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ) => {
      const duration = data.task.durationMinutes;
      const end = targetDateTime.add({ minutes: duration });
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
      targetDateTime: Temporal.ZonedDateTime,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      // Need both startDate and startTime for a scheduled task
      if (!(data.task.startDate && data.task.startTime)) {
        return null;
      }

      // Combine startDate + startTime into ZonedDateTime
      const originalStart: Temporal.ZonedDateTime =
        data.task.startDate.toZonedDateTime({
          timeZone,
          plainTime: data.task.startTime,
        });
      const originalEnd: Temporal.ZonedDateTime = originalStart.add({
        minutes: data.task.durationMinutes,
      });

      if (!isSameDay(originalStart, targetDateTime)) {
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
    [buildPreviewRect, timeZone]
  );

  const previewGoogleMove = useCallback(
    (
      data: Extract<DragData, { type: "google-event" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ) => {
      const eventDurationMinutes = durationInMinutes(data.start, data.end, 1);
      const end = targetDateTime.add({ minutes: eventDurationMinutes });
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
      targetDateTime: Temporal.ZonedDateTime,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      const originalStart = data.start;
      const originalEnd = data.end;

      if (!isSameDay(originalStart, targetDateTime)) {
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
      targetDateTime: Temporal.ZonedDateTime,
      columnTop: number,
      overRect: Pick<PreviewRect, "left" | "width">
    ): PreviewRect | null => {
      const isResizeEnd =
        (data.type === "task-resize" || data.type === "google-event-resize") &&
        data.direction === "end";
      const effectiveTarget = isResizeEnd
        ? targetDateTime.add({ minutes: MINUTES_STEP })
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

  // Prefer droppables the pointer is inside; fall back to closest center.
  const collisionDetection = useCallback<typeof closestCenter>((args) => {
    const intersections = rectIntersection(args);
    if (intersections.length > 0) {
      return intersections;
    }
    return closestCenter(args);
  }, []);

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

      const targetDateTime = slotData.dateTime;
      const minutesFromDayStart =
        targetDateTime.hour * 60 + targetDateTime.minute;
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
    [clearPreview, computePreviewForDrag]
  );

  // Handle scope selection for recurring task updates
  const handleScopeSelect = useCallback(
    (scope: UpdateScope) => {
      if (!pendingUpdate) {
        return;
      }
      updateTask.mutate({
        id: pendingUpdate.id,
        task: pendingUpdate.task,
        scope,
      });
      setPendingUpdate(null);
    },
    [pendingUpdate, updateTask]
  );

  const handleScopeDialogClose = useCallback(() => {
    setPendingUpdate(null);
  }, []);

  return (
    <>
      <DndContext
        autoScroll={false}
        collisionDetection={collisionDetection}
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

      {/* Scope selection dialog for recurring tasks */}
      <AlertDialog
        onOpenChange={(open) => !open && handleScopeDialogClose()}
        open={pendingUpdate !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update recurring task</AlertDialogTitle>
            <AlertDialogDescription>
              This is a recurring task. Which occurrences do you want to update?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleScopeSelect("this")}>
              Only this occurrence
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleScopeSelect("following")}>
              This and following
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
