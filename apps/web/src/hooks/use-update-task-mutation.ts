"use client";

import type { ClientTaskInsert } from "@kompose/api/routers/task/contract";
import type { TaskSelect, TaskUpdate } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { orpc } from "@/utils/orpc";

/**
 * Task update mutation with optimistic cache patch and rollback.
 */
export function useTaskMutations() {
  const queryClient = useQueryClient();

  const createTask = useMutation(
    orpc.tasks.create.mutationOptions({
      onMutate: async (task: ClientTaskInsert) => {
        await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });

        const previousTasks = queryClient.getQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey()
        );

        // Build optimistic task with all required fields
        const optimisticTask: TaskSelect = {
          id: uuidv7(),
          // userId is set server-side but we need a placeholder for optimistic UI
          userId: "optimistic",
          title: task.title,
          description: task.description ?? null,
          status: task.status ?? "todo",
          // Use ISO strings for timestamp fields
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dueDate: task.dueDate ?? null,
          startDate: task.startDate ?? null,
          startTime: task.startTime ?? null,
          durationMinutes: task.durationMinutes ?? 30,
        };

        queryClient.setQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey(),
          (old) => [...(old ?? []), optimisticTask]
        );

        return { previousTasks };
      },
      onError: (_err, _variables, context) => {
        if (context?.previousTasks) {
          queryClient.setQueryData(
            orpc.tasks.list.queryKey(),
            context.previousTasks
          );
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
      },
    })
  );

  const updateTask = useMutation(
    orpc.tasks.update.mutationOptions({
      onMutate: async ({ id, task }: { id: string; task: TaskUpdate }) => {
        await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });

        const previousTasks = queryClient.getQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey()
        );

        queryClient.setQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey(),
          (old) =>
            old?.map((t) =>
              t.id === id
                ? {
                    ...t,
                    ...task,
                    // Use ISO string for timestamp field
                    updatedAt: new Date().toISOString(),
                  }
                : t
            )
        );

        return { previousTasks };
      },
      onError: (_err, _variables, context) => {
        if (context?.previousTasks) {
          queryClient.setQueryData(
            orpc.tasks.list.queryKey(),
            context.previousTasks
          );
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
      },
    })
  );

  const deleteTask = useMutation(
    orpc.tasks.delete.mutationOptions({
      onMutate: async ({ id }: { id: string }) => {
        await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });
        const previousTasks = queryClient.getQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey()
        );
        queryClient.setQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey(),
          (old) => old?.filter((t) => t.id !== id)
        );
        return { previousTasks };
      },
      onError: (_err, _variables, context) => {
        if (context?.previousTasks) {
          queryClient.setQueryData(
            orpc.tasks.list.queryKey(),
            context.previousTasks
          );
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
      },
    })
  );

  return { createTask, updateTask, deleteTask };
}
