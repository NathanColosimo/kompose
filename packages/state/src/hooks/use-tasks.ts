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
import { useStateConfig } from "../config";

interface UseTasksOptions {
  refetchOnMount?: boolean | "always";
  refetchOnWindowFocus?: boolean | "always";
}

/**
 * Centralized hook for task fetching and mutations.
 * Follows the same pattern as Google events: useQuery for fetching,
 * optimistic updates in onMutate, rollback in onError, invalidate in onSettled.
 */
export function useTasks(options: UseTasksOptions = {}) {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();
  const tags = useAtomValue(tagsDataAtom);

  // Fetch tasks using useQuery directly (same pattern as useGoogleEvents)
  const tasksQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const tasks = await orpc.tasks.list();
      return tasks.map((task) => taskSelectCodec.parse(task));
    },
    queryKey: TASKS_QUERY_KEY,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTime: 1000 * 60 * 5,
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
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
    onMutate: async (task: ClientTaskInsertDecoded) => {
      if (task.recurrence) {
        return { optimisticId: undefined, previousTasks: undefined };
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
        createdAt: now,
        description: task.description ?? null,
        dueDate: task.dueDate ?? null,
        durationMinutes: task.durationMinutes ?? 30,
        id: optimisticId,
        isException: false,
        links: task.links ?? [],
        recurrence: null,
        seriesMasterId: null,
        startDate: task.startDate ?? null,
        startTime: task.startTime ?? null,
        status: task.status ?? "todo",
        tags: optimisticTags,
        title: task.title,
        updatedAt: now,
        userId: "optimistic",
      };

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) => [
        ...(old ?? []),
        optimisticTask,
      ]);

      return { optimisticId, previousTasks };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
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
        scope,
        task: encoded,
      });
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
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
            createdAt: t.createdAt,
            tags: nextTags,
            updatedAt: Temporal.Now.instant(),
          };
        })
      );

      return { previousTasks };
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
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(TASKS_QUERY_KEY, context.previousTasks);
      }
    },
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

  return { createTask, deleteTask, parseLink, tasksQuery, updateTask };
}
