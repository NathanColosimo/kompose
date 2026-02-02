"use client";

import type {
  ClientTaskInsertDecoded,
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  clientTaskInsertCodec,
  type TaskSelectDecoded,
  type TaskUpdateDecoded,
  taskSelectCodec,
  taskUpdateCodec,
} from "@kompose/api/routers/task/contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { TASKS_QUERY_KEY, tasksQueryAtom } from "../atoms/tasks";
import { useStateConfig } from "../config";

/**
 * Centralized hook for task fetching and mutations.
 */
export function useTasks() {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();

  // Use the shared tasks query atom so multiple consumers reuse the cache.
  const tasksQuery = useAtomValue(tasksQueryAtom);

  /**
   * Create task mutation with optimistic updates for single tasks.
   */
  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      const results = await orpc.tasks.create.call(encoded);
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      if (task.recurrence) {
        return { previousTasks: undefined, isOptimistic: false };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

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
        seriesMasterId: null,
        recurrence: null,
        isException: false,
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSuccess: (createdTasks, _variables, context) => {
      if (context?.isOptimistic && createdTasks.length === 1) {
        queryClient.setQueryData<TaskSelectDecoded[]>(
          TASKS_QUERY_KEY,
          (old) => {
            if (!old) {
              return createdTasks;
            }
            const withoutOptimistic = old.filter(
              (t) => t.userId !== "optimistic"
            );
            return [...withoutOptimistic, ...createdTasks];
          }
        );
      } else {
        queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
      }
    },
  });

  /**
   * Update task mutation with optimistic updates for scope="this".
   */
  const updateTask = useMutation({
    mutationFn: async ({
      id,
      task,
      scope,
    }: {
      id: string;
      task: TaskUpdateDecoded;
      scope: UpdateScope;
    }) => {
      const encoded = taskUpdateCodec.encode(task);
      const results = await orpc.tasks.update.call({
        id,
        task: encoded,
        scope,
      });
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onMutate: async ({
      id,
      task,
      scope,
    }: {
      id: string;
      task: TaskUpdateDecoded;
      scope: UpdateScope;
    }) => {
      if (scope !== "this") {
        return { previousTasks: undefined, isOptimistic: false };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) =>
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
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSuccess: (updatedTasks, _variables, context) => {
      if (context?.isOptimistic) {
        queryClient.setQueryData<TaskSelectDecoded[]>(
          TASKS_QUERY_KEY,
          (old) => {
            if (!old) {
              return old;
            }
            const updatedMap = new Map(updatedTasks.map((t) => [t.id, t]));
            return old.map((t) => updatedMap.get(t.id) ?? t);
          }
        );
      } else {
        queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
      }
    },
  });

  /**
   * Delete task mutation with optimistic updates for scope="this".
   */
  const deleteTask = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: DeleteScope }) =>
      await orpc.tasks.delete.call({ id, scope }),
    onMutate: async ({ id, scope }: { id: string; scope: DeleteScope }) => {
      if (scope !== "this") {
        return { previousTasks: undefined, isOptimistic: false };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);
      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) =>
        old?.filter((t) => t.id !== id)
      );
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSuccess: (_data, _variables, context) => {
      if (!context?.isOptimistic) {
        queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
      }
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask };
}
