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
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { orpc } from "@/utils/orpc";
import {
  CalendarEventPreview,
  GoogleCalendarEventPreview,
} from "./calendar-event";
import { PIXELS_PER_HOUR } from "./constants";
import { parseSlotId } from "./time-grid";

type CalendarDndProviderProps = {
  children: React.ReactNode;
};

type PreviewRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type DragData =
  | {
      type: "task";
      task: TaskSelect;
    }
  | {
      type: "google-event";
      event: GoogleEvent;
      accountId: string;
      calendarId: string;
      start: Date;
      end: Date;
    };

/**
 * CalendarDndProvider - Wraps the calendar and sidebar with DnD context.
 * Handles drag events and task scheduling mutations.
 */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const [activeTask, setActiveTask] = useState<TaskSelect | null>(null);
  const [activeGoogleEvent, setActiveGoogleEvent] = useState<
    (DragData & { type: "google-event" }) | null
  >(null);
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

  const buildGoogleUpdatePayload = useCallback(
    (event: GoogleEvent, start: Date, end: Date) => {
      const {
        id: _id,
        htmlLink: _htmlLink,
        organizer: _organizer,
        ...rest
      } = event;

      return {
        ...rest,
        start: {
          ...event.start,
          dateTime: start.toISOString(),
          date: undefined,
        },
        end: { ...event.end, dateTime: end.toISOString(), date: undefined },
      };
    },
    []
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData | undefined;

    if (data?.type === "task" && data.task) {
      setActiveTask(data.task);
      setActiveGoogleEvent(null);
      return;
    }

    if (data?.type === "google-event") {
      setActiveGoogleEvent(data);
      setActiveTask(null);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveTask(null);
      setActiveGoogleEvent(null);
      setPreviewRect(null);
      pendingPreviewRef.current = null;
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }

      // No valid drop target
      if (!over) {
        return;
      }

      const overId = String(over.id);

      // Only handle drops on time slots
      if (!overId.startsWith("slot-")) {
        return;
      }

      // Parse the slot to get the target datetime
      const targetDateTime = parseSlotId(overId);
      if (!targetDateTime) {
        return;
      }

      const data = active.data.current as DragData | undefined;
      if (!data) {
        return;
      }

      if (data.type === "task") {
        const task = data.task;
        const durationMinutes = task.durationMinutes;

        updateTaskMutation.mutate({
          id: task.id,
          task: {
            startTime: targetDateTime,
            durationMinutes,
          },
        });
        return;
      }

      if (data.type === "google-event") {
        const durationMinutes =
          (data.end.getTime() - data.start.getTime()) / (60 * 1000);
        const newEnd = new Date(
          targetDateTime.getTime() + durationMinutes * 60 * 1000
        );

        const payload = buildGoogleUpdatePayload(
          data.event,
          targetDateTime,
          newEnd
        );

        updateGoogleEventMutation.mutate({
          accountId: data.accountId,
          calendarId: data.calendarId,
          eventId: data.event.id,
          event: payload,
        });
      }
    },
    [buildGoogleUpdatePayload, updateGoogleEventMutation, updateTaskMutation]
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setPreviewRect(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;

    if (!(over && active)) {
      setPreviewRect(null);
      pendingPreviewRef.current = null;
      return;
    }

    const data = active.data.current as DragData | undefined;

    const overRect = over.rect;
    if (!(overRect && data)) {
      setPreviewRect(null);
      pendingPreviewRef.current = null;
      return;
    }

    let durationMinutes: number | null = null;

    if (data.type === "task") {
      durationMinutes = data.task.durationMinutes;
    } else if (data.type === "google-event") {
      durationMinutes =
        (data.end.getTime() - data.start.getTime()) / (60 * 1000);
    }

    if (durationMinutes === null) {
      setPreviewRect(null);
      pendingPreviewRef.current = null;
      return;
    }

    const height = (durationMinutes / 60) * PIXELS_PER_HOUR;

    pendingPreviewRef.current = {
      top: overRect.top,
      left: overRect.left,
      width: overRect.width,
      height,
    };

    if (previewFrameRef.current === null) {
      previewFrameRef.current = requestAnimationFrame(() => {
        previewFrameRef.current = null;
        setPreviewRect(pendingPreviewRef.current);
        pendingPreviewRef.current = null;
      });
    }
  }, []);

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
      <DragOverlay dropAnimation={null}>
        {activeTask ? <CalendarEventPreview task={activeTask} /> : null}
        {!activeTask && activeGoogleEvent ? (
          <GoogleCalendarEventPreview
            event={activeGoogleEvent.event}
            start={activeGoogleEvent.start}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
