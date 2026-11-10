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
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { timezoneAtom } from "@kompose/state/atoms/current-date";
import { useStateConfig } from "@kompose/state/config";
import {
  type UpdateGoogleEventInput,
  useGoogleEventMutations,
} from "@kompose/state/hooks/use-google-event-mutations";
import { useRecurringEventMaster } from "@kompose/state/hooks/use-recurring-event-master";
import { useTasks } from "@kompose/state/hooks/use-tasks";
import {
  chosenScope,
  type EventSaveChanges,
  eventSaveScopeState,
  RECURRENCE_SCOPE_OPTIONS,
  refuseSave,
  type SaveRefusals,
  SCOPE_DIALOG_COPY,
  seriesRefusalOf,
  seriesSplitBlock,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import { formatEventWhen } from "@kompose/state/temporal-utils";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
  RecurrenceScopeDialog,
  type ScopeDialogSubject,
} from "@/components/recurrence-scope-dialog";
import { SIDEBAR_TASK_LIST_DROPPABLE_ID } from "@/components/sidebar/sidebar-left";
import { minutesFromMidnight } from "@/lib/temporal-utils";
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
  type TaskDropUpdate,
} from "./dnd/drop-handlers";
import {
  clipToDay,
  durationInMinutes,
  edgeDay,
  MINUTES_STEP,
  resizedRange,
} from "./dnd/helpers";
import { movingItemKey, movingItemKeyAtom } from "./dnd/moving-item";
import type { DragData, PreviewRect } from "./dnd/types";
import { eventForScope, saveFacts } from "./events/event-edit-utils";
import { GoogleCalendarEventPreview } from "./events/google-event";
import { TaskEventPreview } from "./events/task-event";
import { COLUMN_FREE_STRIP } from "./time-grid/day-column";

/** A recurring task's drop, waiting for its scope. */
interface PendingTaskUpdate {
  subject: ScopeDialogSubject;
  update: TaskDropUpdate;
}

/** "Standup → Mon, Nov 9 · 9 – 9:15 AM": a dropped task and its new time. */
function taskDropSubject(
  title: string,
  update: TaskDropUpdate,
  moved: boolean,
  timeZone: string
): ScopeDialogSubject {
  const { durationMinutes, startDate, startTime } = update.task;
  const start = startDate.toZonedDateTime({ plainTime: startTime, timeZone });
  return {
    moved,
    name: title || "(No title)",
    when: formatEventWhen(start, start.add({ minutes: durationMinutes })),
  };
}

/** "Retro → Mon, Nov 9 · 4 – 4:45 PM": a dropped occurrence and its new time. */
function droppedSubject(
  pending: PendingGoogleUpdate,
  timeZone: string
): ScopeDialogSubject | undefined {
  const { end, start } = pending.update.event;
  if (!(start?.dateTime && end?.dateTime)) {
    return;
  }
  const when = formatEventWhen(
    Temporal.Instant.from(start.dateTime).toZonedDateTimeISO(timeZone),
    Temporal.Instant.from(end.dateTime).toZonedDateTimeISO(timeZone)
  );
  return {
    moved: pending.moved,
    name: pending.occurrence.summary || "(No title)",
    when,
  };
}

/** A recurring event's dropped move or resize, waiting for its scope. */
interface PendingGoogleUpdate {
  /** A drop moved it; a resize changed its length. */
  moved: boolean;
  occurrence: GoogleEvent;
  /** The scopes the server refused for this drop, and why (`refuseSave`). */
  refused?: SaveRefusals;
  update: UpdateGoogleEventInput;
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
      return action satisfies never;
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
  const setMovingItemKey = useSetAtom(movingItemKeyAtom);

  // A recurring task's or event's move or resize waits for its scope, as
  // in the editors. Each stays after its dialog closes, so the dialog's
  // words don't change as it fades; the next drop replaces it.
  const [pendingUpdate, setPendingUpdate] = useState<PendingTaskUpdate | null>(
    null
  );
  const [taskScope, setTaskScope] = useState<UpdateScope>("this");
  // For an event, a new day applies to this occurrence or from it on.
  const [pendingGoogleUpdate, setPendingGoogleUpdate] =
    useState<PendingGoogleUpdate | null>(null);
  /** The user's own pick in the drop's scope dialog; null until they pick. */
  const [googlePick, setGooglePick] = useState<RecurrenceScope | null>(null);
  const [scopeDialog, setScopeDialog] = useState<"google" | "task" | null>(
    null
  );
  // The dragged occurrence's series loads from the drag's start (the hook
  // fetches for an occurrence only), so the drop's dialog usually opens
  // with its choices ready.
  const pendingMaster = useRecurringEventMaster({
    accountId:
      activeGoogleEvent?.accountId ??
      pendingGoogleUpdate?.update.accountId ??
      "",
    calendarId:
      activeGoogleEvent?.calendarId ??
      pendingGoogleUpdate?.update.calendarId ??
      "",
    enabled: Boolean(activeGoogleEvent) || scopeDialog === "google",
    event: activeGoogleEvent?.event ?? pendingGoogleUpdate?.occurrence ?? null,
  });

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
  const { notifyError } = useStateConfig();

  const clearPreview = useCallback(() => {
    pendingPreviewRef.current = null;
    dispatch({ rect: null, type: "set-preview" });
    setDropSlot(null);
  }, [setDropSlot]);

  const resetDragState = useCallback(() => {
    dispatch({ type: "reset" });
    setDropSlot(null);
    setMovingItemKey(null);
    lastDropTargetKeyRef.current = null;
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, [setDropSlot, setMovingItemKey]);

  const handleTaskMoveDrop = useCallback(
    (task: TaskSelectDecoded, startTime: Temporal.ZonedDateTime) => {
      const update = buildTaskMoveUpdate(task, startTime);

      // A dated series occurrence asks this-or-following; one moved to the
      // inbox has nothing following it.
      if (task.seriesMasterId && task.startDate) {
        setPendingUpdate({
          subject: taskDropSubject(task.title, update, true, timeZone),
          update,
        });
        setTaskScope("this");
        setScopeDialog("task");
        return;
      }

      updateTask.mutate(update);
    },
    [updateTask, timeZone]
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

      if (payload.task.seriesMasterId && payload.task.startDate) {
        setPendingUpdate({
          subject: taskDropSubject(payload.task.title, update, false, timeZone),
          update,
        });
        setTaskScope("this");
        setScopeDialog("task");
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
      if (data.event.recurringEventId) {
        setGooglePick(null);
        setPendingGoogleUpdate({ moved: true, occurrence: data.event, update });
        setScopeDialog("google");
        return;
      }
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
      if (data.event.recurringEventId) {
        setGooglePick(null);
        setPendingGoogleUpdate({
          moved: false,
          occurrence: data.event,
          update,
        });
        setScopeDialog("google");
        return;
      }

      updateGoogleEventMutation.mutate(update);
    },
    [updateGoogleEventMutation]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const data = active.data.current as DragData | undefined;
      setMovingItemKey(data ? movingItemKey(data) : null);

      if (
        (data?.type === "task" || data?.type === "task-resize") &&
        data.task
      ) {
        dispatch({
          resizing: data.type === "task-resize",
          task: data.task,
          type: "start-task",
        });
        return;
      }

      if (
        data?.type === "google-event" ||
        data?.type === "google-event-resize"
      ) {
        dispatch({
          data,
          resizing: data.type === "google-event-resize",
          type: "start-google-event",
        });
      }
    },
    [setMovingItemKey]
  );

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
          handleTaskMoveDrop(
            data.task,
            targetDateTime.subtract({ minutes: data.grabOffsetMinutes ?? 0 })
          );
          return;
        case "task-resize":
          handleTaskResizeDrop({
            direction: data.direction,
            targetDateTime: targetDateTimeAdjusted,
            task: data.task,
          });
          return;
        case "google-event":
          handleGoogleEventDrop(
            data,
            targetDateTime.subtract({ minutes: data.grabOffsetMinutes ?? 0 })
          );
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
      columnRect,
      day,
      minimum = MINUTES_STEP,
      range,
    }: {
      columnRect: ClientRect;
      /** The target column's day; the preview shows the part on that day. */
      day: Temporal.PlainDate;
      minimum?: number;
      range: { end: Temporal.ZonedDateTime; start: Temporal.ZonedDateTime };
    }): PreviewRect => {
      const { end, start } = clipToDay(range, day);
      const startMinutes = minutesFromMidnight(start);
      const duration = durationInMinutes(start, end, minimum);
      // Ensure 15-minute blocks render at slot height (20px).
      const height = Math.max((duration / 60) * PIXELS_PER_HOUR, 20);

      return {
        height,
        left: columnRect.left,
        top: columnRect.top + (startMinutes / 60) * PIXELS_PER_HOUR,
        // As wide as the blocks, not over the column's free strip.
        width: columnRect.width - COLUMN_FREE_STRIP,
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
      const start = targetDateTime.subtract({
        minutes: data.grabOffsetMinutes ?? 0,
      });
      return buildPreviewRect({
        columnRect,
        day: targetDateTime.toPlainDate(),
        range: {
          end: start.add({ minutes: data.task.durationMinutes }),
          start,
        },
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
      const start = data.task.startDate.toZonedDateTime({
        plainTime: data.task.startTime,
        timeZone,
      });
      const range = resizedRange({
        direction: data.direction,
        end: start.add({ minutes: data.task.durationMinutes }),
        start,
        target: targetDateTime,
      });
      return range
        ? buildPreviewRect({
            columnRect,
            // The hovered column: an end at midnight is the day before's.
            day: edgeDay(data.direction, range.start, range.end),
            range,
          })
        : null;
    },
    [buildPreviewRect, timeZone]
  );

  const previewGoogleMove = useCallback(
    (
      data: Extract<DragData, { type: "google-event" }>,
      targetDateTime: Temporal.ZonedDateTime,
      columnRect: ClientRect
    ) => {
      const start = targetDateTime.subtract({
        minutes: data.grabOffsetMinutes ?? 0,
      });
      const duration = durationInMinutes(data.start, data.end, 1);
      return buildPreviewRect({
        columnRect,
        day: targetDateTime.toPlainDate(),
        minimum: 1,
        range: { end: start.add({ minutes: duration }), start },
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
      const range = resizedRange({
        direction: data.direction,
        end: data.end,
        start: data.start,
        target: targetDateTime,
      });
      return range
        ? buildPreviewRect({
            columnRect,
            day: edgeDay(data.direction, range.start, range.end),
            minimum: 1,
            range,
          })
        : null;
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

  const confirmTaskScope = useCallback(() => {
    if (pendingUpdate) {
      updateTask.mutate({ ...pendingUpdate.update, scope: taskScope });
    }
  }, [pendingUpdate, taskScope, updateTask]);

  const googleSaveChanges: EventSaveChanges | null = pendingGoogleUpdate
    ? {
        calendarChanged: false,
        // A new day, or a new time on its own day, as the editor reads it.
        ...saveFacts({
          edited: pendingGoogleUpdate.update.event,
          event: pendingGoogleUpdate.occurrence,
          master: pendingMaster.data ?? undefined,
          timeZone,
        }),
        patternChanged: false,
        refused: pendingGoogleUpdate.refused,
        seriesRuleFailed: pendingMaster.ruleFailed,
        seriesRuleLoaded: pendingMaster.ruleReady,
        splitBlocked: seriesSplitBlock(
          pendingGoogleUpdate.occurrence,
          pendingMaster.data,
          timeZone
        ),
      }
    : null;

  // The drop's dialog: the scopes it can't use and its line saying why, and
  // the scope it shows and saves with, all worked out each time.
  const googleDialog = googleSaveChanges
    ? eventSaveScopeState(googleSaveChanges)
    : { description: SCOPE_DIALOG_COPY.saveEvent.description, disabled: {} };
  const googleScope = chosenScope(googlePick, "this", googleDialog.disabled);

  // The dialog stays open while this runs, and after it rejects.
  const confirmGoogleScope = useCallback(async () => {
    if (!pendingGoogleUpdate) {
      return;
    }
    const { occurrence, update } = pendingGoogleUpdate;
    try {
      await updateGoogleEventMutation.mutateAsync({
        ...update,
        // For the series, only the new time (and a rule following a moved
        // day): an occurrence renamed or rescheduled on its own keeps that.
        event: eventForScope({
          edited: update.event,
          master: pendingMaster.data ?? undefined,
          occurrence,
          scope: googleScope,
          timeZone,
        }),
        // Said below: a refusal in the dialog, anything else as a toast.
        quiet: true,
        recurrenceScope: googleScope,
      });
    } catch (error) {
      const refusal = seriesRefusalOf(error);
      if (refusal) {
        // The server won't make this write: ask again, as the editor does,
        // with that scope off and its reason leading the dialog.
        setPendingGoogleUpdate({
          ...pendingGoogleUpdate,
          refused: refuseSave(
            pendingGoogleUpdate.refused,
            googleScope,
            refusal
          ),
        });
        throw error;
      }
      // Any other failure closes the dialog and is reported.
      if (error instanceof Error) {
        notifyError?.(error);
      }
    }
  }, [
    googleScope,
    notifyError,
    pendingGoogleUpdate,
    pendingMaster.data,
    timeZone,
    updateGoogleEventMutation,
  ]);

  return (
    <>
      <DndContext
        // Dragging is pointer-only (PointerSensor), so the default "press
        // space to pick up" instructions would be wrong.
        accessibility={{
          screenReaderInstructions: {
            draggable: "Press Enter to open. Drag with a pointer to move.",
          },
        }}
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

      <RecurrenceScopeDialog
        description={googleDialog.description}
        disabledScopes={googleDialog.disabled}
        onConfirm={confirmGoogleScope}
        onOpenChange={(open) => setScopeDialog(open ? "google" : null)}
        onValueChange={setGooglePick}
        open={scopeDialog === "google"}
        options={RECURRENCE_SCOPE_OPTIONS}
        subject={
          pendingGoogleUpdate
            ? droppedSubject(pendingGoogleUpdate, timeZone)
            : undefined
        }
        title={SCOPE_DIALOG_COPY.saveEvent.title}
        value={googleScope}
      />

      <RecurrenceScopeDialog
        description={SCOPE_DIALOG_COPY.saveTask.description}
        onConfirm={confirmTaskScope}
        onOpenChange={(open) => setScopeDialog(open ? "task" : null)}
        onValueChange={setTaskScope}
        open={scopeDialog === "task"}
        options={TASK_UPDATE_SCOPE_OPTIONS}
        subject={pendingUpdate?.subject}
        title={SCOPE_DIALOG_COPY.saveTask.title}
        value={taskScope}
      />
    </>
  );
}
