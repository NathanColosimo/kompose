"use client";

import type {
  TaskInsert,
  TaskSelect,
  TaskUpdate,
} from "@kompose/db/schema/task";
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
      onMutate: async (task: TaskInsert) => {
        await queryClient.cancelQueries({ queryKey: orpc.tasks.list.key() });

        const previousTasks = queryClient.getQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey()
        );

        queryClient.setQueryData<TaskSelect[]>(
          orpc.tasks.list.queryKey(),
          (old) => [
            ...(old ?? []),
            {
              ...task,
              id: uuidv7(),
              description: task.description ?? null,
              status: task.status ?? "todo",
              createdAt: new Date(),
              updatedAt: new Date(),
              dueDate: task.dueDate ?? null,
              startDate: task.startDate ?? null,
              startTime: task.startTime ?? null,
              durationMinutes: task.durationMinutes ?? 30,
            },
          ]
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
                    updatedAt: new Date(),
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
