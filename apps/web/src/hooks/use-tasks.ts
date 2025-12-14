"use client";

import type { ClientTaskInsertDecoded } from "@kompose/api/routers/task/contract";
import {
  clientTaskInsertCodec,
  type TaskSelectDecoded,
  type TaskUpdateDecoded,
  taskSelectCodec,
  taskUpdateCodec,
} from "@kompose/api/routers/task/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { orpc } from "@/utils/orpc";

/** Query key for tasks - shared between query and mutations */
const TASKS_KEY = ["tasks", "list"] as const;

/**
 * Centralized hook for task fetching and mutations.
 * - Fetches tasks and decodes to Temporal types
 * - Mutations accept decoded types and encode at API boundary
 * - Optimistic updates work with decoded types in cache
 */
export function useTasks() {
  const queryClient = useQueryClient();

  // Fetch and decode tasks
  const tasksQuery = useQuery({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const tasks = await orpc.tasks.list.call();
      return tasks.map((t) => taskSelectCodec.parse(t));
    },
  });

  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      return await orpc.tasks.create.call(encoded);
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_KEY);

      const now = Temporal.Now.instant();
      const optimisticTask: TaskSelectDecoded = {
        id: uuidv7(),
        userId: "optimistic",
        title: task.title,
        description: task.description ?? null,
        status: task.status ?? "todo",
        createdAt: now,
        updatedAt: now,
        dueDate: task.dueDate ?? null,
        startDate: task.startDate ?? null,
        startTime: task.startTime ?? null,
        durationMinutes: task.durationMinutes ?? 30,
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);
      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({
      id,
      task,
    }: {
      id: string;
      task: TaskUpdateDecoded;
    }) => {
      const encoded = taskUpdateCodec.encode(task);
      return await orpc.tasks.update.call({ id, task: encoded });
    },
    onMutate: async ({ id, task }: { id: string; task: TaskUpdateDecoded }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_KEY);

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) =>
        old?.map((t) =>
          t.id === id
            ? {
                ...t,
                ...task,
                createdAt: t.createdAt,
                updatedAt: Temporal.Now.instant(),
              }
            : t
        )
      );
      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      await orpc.tasks.delete.call({ id }),
    onMutate: async ({ id }: { id: string }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_KEY);
      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) =>
        old?.filter((t) => t.id !== id)
      );
      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask };
}
