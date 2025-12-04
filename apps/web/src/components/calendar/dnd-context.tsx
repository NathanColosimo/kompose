"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskSelect } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { useCallback, useState } from "react";
import { orpc } from "@/utils/orpc";
import { CalendarEventPreview } from "./calendar-event";
import { parseSlotId } from "./time-grid";

/** Default duration for newly scheduled tasks (in minutes) */
const DEFAULT_TASK_DURATION_MINUTES = 30;

type CalendarDndProviderProps = {
  children: React.ReactNode;
};

/**
 * CalendarDndProvider - Wraps the calendar and sidebar with DnD context.
 * Handles drag events and task scheduling mutations.
 */
export function CalendarDndProvider({ children }: CalendarDndProviderProps) {
  const [activeTask, setActiveTask] = useState<TaskSelect | null>(null);
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

      // Calculate end time (default 1 hour duration)
      const endDateTime = addMinutes(
        targetDateTime,
        DEFAULT_TASK_DURATION_MINUTES
      );

      // Update the task with new schedule
      updateTaskMutation.mutate({
        id: task.id,
        task: {
          startTime: targetDateTime,
          endTime: endDateTime,
        },
      });
    },
    [updateTaskMutation]
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      {children}

      {/* Drag overlay for smooth preview during drag */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? <CalendarEventPreview task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
