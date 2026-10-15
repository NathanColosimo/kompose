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
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import { useGoogleEventMutations } from "@kompose/state/hooks/use-google-event-mutations";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
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

interface SidebarDropData {
  activeTab?: string;
  sidebarTargetDate?: string;
  sidebarView?: "inbox" | "today";
}

type ActiveGoogleEventData = Extract<
  DragData,
  { type: "google-event" | "google-event-resize" }
>;

interface DragState {
  activeGoogleEvent: ActiveGoogleEventData | null;
  activeTask: TaskSelectDecoded | null;
  isResizing: boolean;
  previewRect: PreviewRect | null;
}

const initialDragState: DragState = {
  activeGoogleEvent: null,
  activeTask: null,
  isResizing: false,
  previewRect: null,
};

type DragAction =
  | { type: "start-task"; resizing: boolean; task: TaskSelectDecoded }
  | {
      type: "start-google-event";
      data: ActiveGoogleEventData;
      resizing: boolean;
    }
  | { type: "set-preview"; rect: PreviewRect | null }
  | { type: "reset" };

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "start-task":
      return {
        ...initialDragState,
        activeTask: action.task,
        isResizing: action.resizing,
      };
    case "start-google-event":
      return {
        ...initialDragState,
        activeGoogleEvent: action.data,
        isResizing: action.resizing,
      };
    case "set-preview":
      return state.previewRect === action.rect
        ? state
        : { ...state, previewRect: action.rect };
    case "reset":
      return initialDragState;
    default:
      return state;
  }
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
  const [drag, dispatch] = useReducer(dragReducer, initialDragState);
  const { activeTask, activeGoogleEvent, isResizing, previewRect } = drag;
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
    dispatch({ rect: null, type: "set-preview" });
  }, []);

  const resetDragState = useCallback(() => {
    dispatch({ type: "reset" });
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, []);

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
   * If dropped on the date sidebar, sets startDate to that date but clears startTime.
   */
  const handleTaskUnschedule = useCallback(
    (task: TaskSelectDecoded, sidebarData?: SidebarDropData) => {
      const shouldMoveToDateSidebar =
        sidebarData?.sidebarView === "today" ||
        sidebarData?.activeTab === "Today";

      if (shouldMoveToDateSidebar) {
        const targetDate = sidebarData?.sidebarTargetDate
          ? Temporal.PlainDate.from(sidebarData.sidebarTargetDate)
          : Temporal.Now.plainDateISO(timeZone);

        updateTask.mutate({
          id: task.id,
          scope: "this",
          task: {
            durationMinutes: task.durationMinutes,
            startDate: targetDate,
            startTime: null,
          },
        });
        return;
      }

      // Default behavior: clear both startDate and startTime (move to inbox)
      updateTask.mutate({
        id: task.id,
        // Unscheduling affects just this occurrence
        scope: "this",
        task: {
          durationMinutes: task.durationMinutes,
          startDate: null,
          startTime: null,
        },
      });
    },
    [updateTask, timeZone]
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
      dispatch({
        resizing: data.type === "task-resize",
        task: data.task,
        type: "start-task",
      });
      return;
    }

    if (data?.type === "google-event" || data?.type === "google-event-resize") {
      dispatch({
        data,
        resizing: data.type === "google-event-resize",
        type: "start-google-event",
      });
    }
  }, []);

  // Handle drops on the sidebar list by unscheduling task cards.
  const handleSidebarDrop = useCallback(
    (data: DragData, sidebarData?: SidebarDropData) => {
      if (data.type !== "task") {
        return;
      }

      handleTaskUnschedule(data.task, sidebarData);
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
            direction: data.direction,
            targetDateTime: targetDateTimeAdjusted,
            task: data.task,
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
        const sidebarData = over.data?.current as SidebarDropData | undefined;
        handleSidebarDrop(data, sidebarData);
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
      // Ensure 15-minute blocks render at slot height (20px).
      const height = Math.max((duration / 60) * PIXELS_PER_HOUR, 20);

      return {
        height,
        left: overRect.left,
        top: columnTop + (startMinutes / 60) * PIXELS_PER_HOUR,
        width: overRect.width,
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
        columnTop,
        end,
        overRect,
        start: targetDateTime,
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
          plainTime: data.task.startTime,
          timeZone,
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
          columnTop,
          end: originalEnd,
          overRect,
          start: newStart,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        columnTop,
        end: newEnd,
        overRect,
        start: originalStart,
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
        columnTop,
        end,
        minimum: 1,
        overRect,
        start: targetDateTime,
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
          columnTop,
          end: originalEnd,
          minimum: 1,
          overRect,
          start: newStart,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        columnTop,
        end: newEnd,
        minimum: 1,
        overRect,
        start: originalStart,
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
          accountId={activeGoogleEvent.accountId}
          calendarId={activeGoogleEvent.calendarId}
          end={activeGoogleEvent.end}
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

      // Only show preview when hovering over calendar slots (which have dateTime)
      // Sidebar droppables have different data (e.g. activeTab) without dateTime
      if (!(overRect && data && slotData?.dateTime)) {
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
          dispatch({ rect: pendingPreviewRef.current, type: "set-preview" });
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
        scope,
        task: pendingUpdate.task,
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
              height: previewRect.height,
              left: previewRect.left,
              top: previewRect.top,
              width: previewRect.width,
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
