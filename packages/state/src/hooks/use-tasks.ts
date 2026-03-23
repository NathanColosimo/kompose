"use client";

import type {
  ClientTaskInsertDecoded,
  DeleteScope,
  LinkMeta,
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
      const tasks = await orpc.tasks.list();
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
      const results = await orpc.tasks.create(encoded);
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      if (task.recurrence) {
        return { previousTasks: undefined, optimisticId: undefined };
      }

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      const now = Temporal.Now.instant();
      const optimisticTags =
        task.tagIds && task.tagIds.length > 0
          ? tags.filter((tag) => task.tagIds?.includes(tag.id))
          : [];

      const optimisticId = uuidv7();
      const optimisticTask: TaskSelectDecoded = {
        id: optimisticId,
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
        links: task.links ?? [],
        seriesMasterId: null,
        recurrence: null,
        isException: false,
        tags: optimisticTags,
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);

      return { previousTasks, optimisticId };
    },
    onSuccess: (createdTasks, _variables, context) => {
      if (!context?.optimisticId) {
        return;
      }
      // Replace the optimistic placeholder with the real server response
      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) => {
        if (!old) {
          return createdTasks;
        }
        const withoutOptimistic = old.filter(
          (t) => t.id !== context.optimisticId
        );
        return [...withoutOptimistic, ...createdTasks];
      });
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
      const results = await orpc.tasks.update({
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
            task.tagIds === undefined
              ? t.tags
              : tags.filter((tag) => (task.tagIds ?? []).includes(tag.id));

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
      await orpc.tasks.delete({ id, scope }),
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

  /** Parse a URL to extract provider metadata (title, duration, etc.) */
  const parseLink = useMutation({
    mutationFn: async (url: string): Promise<LinkMeta> => {
      const result = await orpc.tasks.parseLink({ url });
      return result as LinkMeta;
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask, parseLink };
}
