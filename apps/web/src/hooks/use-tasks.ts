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
 * - Optimistic updates only for single-task operations (no recurrence, scope="this")
 * - Multi-task operations invalidate queries on success
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
    staleTime: 1000 * 60 * 5,
  });

  /**
   * Create task mutation.
   * - Optimistic update only for non-recurring tasks (single creation)
   * - Recurring tasks invalidate on success (API creates multiple rows)
   */
  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      const results = await orpc.tasks.create.call(encoded);
      // Decode returned tasks for cache update
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      // Only optimistic update for non-recurring tasks
      if (task.recurrence) {
        return { previousTasks: undefined, isOptimistic: false };
      }

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
        seriesMasterId: null,
        recurrence: null,
        isException: false,
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSuccess: (createdTasks, _variables, context) => {
      // If we did optimistic update, replace optimistic task with real one
      if (context?.isOptimistic && createdTasks.length === 1) {
        queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) => {
          if (!old) {
            return createdTasks;
          }
          // Remove optimistic task and add real one
          const withoutOptimistic = old.filter(
            (t) => t.userId !== "optimistic"
          );
          return [...withoutOptimistic, ...createdTasks];
        });
      } else {
        // Multi-task creation (recurring): invalidate to fetch all
        queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      }
    },
  });

  /**
   * Update task mutation.
   * - Optimistic update only for scope="this" (single task update)
   * - scope="all" or "following" invalidates on success (multiple tasks affected)
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
      // Only optimistic update for scope="this"
      if (scope !== "this") {
        return { previousTasks: undefined, isOptimistic: false };
      }

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
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSuccess: (updatedTasks, _variables, context) => {
      if (context?.isOptimistic) {
        // Replace optimistic data with server response for single task
        queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) => {
          if (!old) {
            return old;
          }
          const updatedMap = new Map(updatedTasks.map((t) => [t.id, t]));
          return old.map((t) => updatedMap.get(t.id) ?? t);
        });
      } else {
        // Multi-task update: invalidate to fetch all changes
        queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      }
    },
  });

  /**
   * Delete task mutation.
   * - Optimistic update only for scope="this" (single task delete)
   * - scope="following" invalidates on success (multiple tasks affected)
   */
  const deleteTask = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: DeleteScope }) =>
      await orpc.tasks.delete.call({ id, scope }),
    onMutate: async ({ id, scope }: { id: string; scope: DeleteScope }) => {
      // Only optimistic update for scope="this"
      if (scope !== "this") {
        return { previousTasks: undefined, isOptimistic: false };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_KEY);
      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_KEY, (old) =>
        old?.filter((t) => t.id !== id)
      );
      return { previousTasks, isOptimistic: true };
    },
    onError: (_err, _variables, context) => {
      if (context?.isOptimistic && context?.previousTasks) {
        queryClient.setQueryData(TASKS_KEY, context.previousTasks);
      }
    },
    onSuccess: (_data, _variables, context) => {
      if (!context?.isOptimistic) {
        // Multi-task delete: invalidate to reflect all changes
        queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      }
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask };
}
