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
import { useCallback, useState } from "react";
import { orpc } from "@/utils/orpc";
import { CalendarEventPreview } from "./calendar-event";
import { PIXELS_PER_HOUR } from "./constants";
import { parseSlotId } from "./time-grid";

type CalendarDndProviderProps = {
  children: React.ReactNode;
};

/**
 * CalendarDndProvider - Wraps the calendar and sidebar with DnD context.
 * Handles drag events and task scheduling mutations.
 */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const [activeTask, setActiveTask] = useState<TaskSelect | null>(null);
  const [previewRect, setPreviewRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const queryClient = useQueryClient();

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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const task = active.data.current?.task as TaskSelect | undefined;
    if (task) {
      setActiveTask(task);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveTask(null);
      setPreviewRect(null);

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

      // Get the task being dragged
      const task = active.data.current?.task as TaskSelect | undefined;
      if (!task) {
        return;
      }

      // Preserve existing duration when re-scheduling
      const durationMinutes = task.durationMinutes;

      // Update the task with new schedule
      updateTaskMutation.mutate({
        id: task.id,
        task: {
          startTime: targetDateTime,
          durationMinutes,
        },
      });
    },
    [updateTaskMutation]
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
    setPreviewRect(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;

    if (!(over && active)) {
      setPreviewRect(null);
      return;
    }

    const task = active.data.current?.task as TaskSelect | undefined;
    if (!task) {
      setPreviewRect(null);
      return;
    }

    const overRect = over.rect;
    if (!overRect) {
      setPreviewRect(null);
      return;
    }

    const durationMinutes = task.durationMinutes;
    const height = (durationMinutes / 60) * PIXELS_PER_HOUR;

    setPreviewRect({
      top: overRect.top,
      left: overRect.left,
      width: overRect.width,
      height,
    });
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
      {children}

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
      </DragOverlay>
    </DndContext>
  );
}
