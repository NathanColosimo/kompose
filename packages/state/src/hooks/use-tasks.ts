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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { tagsDataAtom } from "../atoms/tags";
import { TASKS_QUERY_KEY } from "../atoms/tasks";
import { hasSessionAtom, useStateConfig } from "../config";

/**
 * Centralized hook for task fetching and mutations.
 * Follows the same pattern as Google events: useQuery for fetching,
 * optimistic updates in onMutate, rollback in onError, invalidate in onSettled.
 */
export function useTasks() {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();
  const hasSession = useAtomValue(hasSessionAtom);
  const tags = useAtomValue(tagsDataAtom);

  // Fetch tasks using useQuery directly (same pattern as useGoogleEvents)
  const tasksQuery = useQuery({
    queryKey: TASKS_QUERY_KEY,
    enabled: hasSession,
    queryFn: async () => {
      const tasks = await orpc.tasks.list.call();
      return tasks.map((task) => taskSelectCodec.parse(task));
    },
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });

  /**
   * Create task mutation with optimistic updates.
   */
  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      const results = await orpc.tasks.create.call(encoded);
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      // Skip optimistic update for recurring tasks (creates multiple)
      if (task.recurrence) {
        return { previousTasks: undefined };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      const now = Temporal.Now.instant();
      const optimisticTags =
        task.tagIds && task.tagIds.length > 0
          ? tags.filter((tag) => task.tagIds?.includes(tag.id))
          : [];

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
        tags: optimisticTags,
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);

      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  /**
   * Update task mutation with optimistic updates.
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
      // Only optimistic update for scope="this" (single task)
      if (scope !== "this") {
        return { previousTasks: undefined };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) =>
        old?.map((t) => {
          if (t.id !== id) {
            return t;
          }

          const nextTags =
            task.tagIds !== undefined
              ? tags.filter((tag) => (task.tagIds ?? []).includes(tag.id))
              : t.tags;

          return {
            ...t,
            ...task,
            tags: nextTags,
            createdAt: t.createdAt,
            updatedAt: Temporal.Now.instant(),
          };
        })
      );

      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  /**
   * Delete task mutation with optimistic updates.
   */
  const deleteTask = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: DeleteScope }) =>
      await orpc.tasks.delete.call({ id, scope }),
    onMutate: async ({ id, scope }: { id: string; scope: DeleteScope }) => {
      // Only optimistic update for scope="this" (single task)
      if (scope !== "this") {
        return { previousTasks: undefined };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) =>
        old?.filter((t) => t.id !== id)
      );

      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask };
}
