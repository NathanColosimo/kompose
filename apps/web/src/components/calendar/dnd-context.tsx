"use client";

import {
  type ClientRect,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
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
import { useAtomValue, useSetAtom } from "jotai";
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
  calendarCollisionDetection,
  dropSlotAtom,
  getDropSlot,
  slotDateTime,
} from "./dnd/day-column-slots";
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
import type { DragData, PreviewRect } from "./dnd/types";
import { GoogleCalendarEventPreview } from "./events/google-event";
import { TaskEventPreview } from "./events/task-event";

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

/** See documents/dnd.md for drop targets, previews, and mutation behavior. */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const timeZone = useAtomValue(timezoneAtom);
  const [drag, dispatch] = useReducer(dragReducer, initialDragState);
  const { activeTask, activeGoogleEvent, isResizing, previewRect } = drag;
  const previewFrameRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<PreviewRect | null>(null);
  // Drop target the preview was last computed for; skips unchanged moves.
  const lastDropTargetKeyRef = useRef<string | null>(null);
  const setDropSlot = useSetAtom(dropSlotAtom);

  const [pendingUpdate, setPendingUpdate] = useState<PendingTaskUpdate | null>(
    null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance to prevent accidental drags
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const { updateTask } = useTasks();
  const { updateEvent: updateGoogleEventMutation } = useGoogleEventMutations();

  const clearPreview = useCallback(() => {
    pendingPreviewRef.current = null;
    dispatch({ rect: null, type: "set-preview" });
    setDropSlot(null);
  }, [setDropSlot]);

  const resetDragState = useCallback(() => {
    dispatch({ type: "reset" });
    setDropSlot(null);
    lastDropTargetKeyRef.current = null;
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, [setDropSlot]);

  const handleTaskMoveDrop = useCallback(
    (task: TaskSelectDecoded, startTime: Temporal.ZonedDateTime) => {
      const update = buildTaskMoveUpdate(task, startTime);

      if (task.seriesMasterId) {
        setPendingUpdate({ id: update.id, task: update.task });
        return;
      }

      updateTask.mutate(update);
    },
    [updateTask]
  );

  /** Today keeps a date without a time; other sidebar drops return the task to Inbox. */
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

  const handleSidebarDrop = useCallback(
    (data: DragData, sidebarData?: SidebarDropData) => {
      if (data.type !== "task") {
        return;
      }

      handleTaskUnschedule(data.task, sidebarData);
    },
    [handleTaskUnschedule]
  );

  const handleSlotDrop = useCallback(
    (data: DragData, targetDateTime: Temporal.ZonedDateTime) => {
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

      const slot = getDropSlot(event.collisions);
      if (slot) {
        handleSlotDrop(data, slotDateTime(slot));
      }
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
      columnRect,
      minimum = MINUTES_STEP,
    }: {
      start: Temporal.ZonedDateTime;
      end: Temporal.ZonedDateTime;
      columnRect: ClientRect;
      minimum?: number;
    }): PreviewRect => {
      const startMinutes = minutesFromMidnight(start);
      const duration = durationInMinutes(start, end, minimum);
      // Ensure 15-minute blocks render at slot height (20px).
      const height = Math.max((duration / 60) * PIXELS_PER_HOUR, 20);

      return {
        height,
        left: columnRect.left,
        top: columnRect.top + (startMinutes / 60) * PIXELS_PER_HOUR,
        width: columnRect.width,
      };
    },
    []
  );

  const previewTaskMove = useCallback(
    (
      data: Extract<DragData, { type: "task" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
    ) => {
      const duration = data.task.durationMinutes;
      const end = targetDateTime.add({ minutes: duration });
      return buildPreviewRect({
        columnRect,
        end,
        start: targetDateTime,
      });
    },
    [buildPreviewRect]
  );

  const previewTaskResize = useCallback(
    (
      data: Extract<DragData, { type: "task-resize" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
    ): PreviewRect | null => {
      if (!(data.task.startDate && data.task.startTime)) {
        return null;
      }

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
          columnRect,
          end: originalEnd,
          start: newStart,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        columnRect,
        end: newEnd,
        start: originalStart,
      });
    },
    [buildPreviewRect, timeZone]
  );

  const previewGoogleMove = useCallback(
    (
      data: Extract<DragData, { type: "google-event" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
    ) => {
      const eventDurationMinutes = durationInMinutes(data.start, data.end, 1);
      const end = targetDateTime.add({ minutes: eventDurationMinutes });
      return buildPreviewRect({
        columnRect,
        end,
        minimum: 1,
        start: targetDateTime,
      });
    },
    [buildPreviewRect]
  );

  const previewGoogleResize = useCallback(
    (
      data: Extract<DragData, { type: "google-event-resize" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
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
          columnRect,
          end: originalEnd,
          minimum: 1,
          start: newStart,
        });
      }

      const newEnd = clampResizeEnd(targetDateTime, originalStart);
      return buildPreviewRect({
        columnRect,
        end: newEnd,
        minimum: 1,
        start: originalStart,
      });
    },
    [buildPreviewRect]
  );

  const computePreviewForDrag = useCallback(
    (
      data: DragData,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
    ): PreviewRect | null => {
      const isResizeEnd =
        (data.type === "task-resize" || data.type === "google-event-resize") &&
        data.direction === "end";
      const effectiveTarget = isResizeEnd
        ? targetDateTime.add({ minutes: MINUTES_STEP })
        : targetDateTime;

      switch (data.type) {
        case "task":
          return previewTaskMove(data, effectiveTarget, columnRect);
        case "task-resize":
          return previewTaskResize(data, effectiveTarget, columnRect);
        case "google-event":
          return previewGoogleMove(data, effectiveTarget, columnRect);
        case "google-event-resize":
          return previewGoogleResize(data, effectiveTarget, columnRect);
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

  // `onDragOver` fires only when the hovered column changes, so the slot
  // within a column is read from the collisions on every move.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const data = event.active.data.current as DragData | undefined;
      const slot = getDropSlot(event.collisions);

      // Only show a preview over calendar columns; the sidebar has none.
      if (!(data && slot)) {
        if (lastDropTargetKeyRef.current !== null) {
          lastDropTargetKeyRef.current = null;
          clearPreview();
        }
        return;
      }

      // The column rect moves when the grid scrolls mid-drag.
      const { column, columnRect, index } = slot;
      const targetKey = `${column.date}|${index}|${columnRect.top}|${columnRect.left}|${columnRect.width}`;
      if (targetKey === lastDropTargetKeyRef.current) {
        return;
      }
      lastDropTargetKeyRef.current = targetKey;
      setDropSlot(slot);

      pendingPreviewRef.current = computePreviewForDrag(
        data,
        slotDateTime(slot),
        columnRect
      );

      if (previewFrameRef.current === null) {
        previewFrameRef.current = requestAnimationFrame(() => {
          previewFrameRef.current = null;
          dispatch({ rect: pendingPreviewRef.current, type: "set-preview" });
          pendingPreviewRef.current = null;
        });
      }
    },
    [clearPreview, computePreviewForDrag, setDropSlot]
  );

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
        collisionDetection={calendarCollisionDetection}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragMove={handleDragMove}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        {children}

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

        {overlayContent ? (
          <DragOverlay dropAnimation={null}>{overlayContent}</DragOverlay>
        ) : null}
      </DndContext>

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
