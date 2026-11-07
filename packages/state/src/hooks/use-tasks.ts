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
import { TASKS_QUERY_KEY, tasksQueryOptions } from "../atoms/tasks";
import { useStateConfig } from "../config";

interface UseTasksOptions {
  refetchOnMount?: boolean | "always";
  refetchOnWindowFocus?: boolean | "always";
}

export function useTasks(options: UseTasksOptions = {}) {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();
  const tags = useAtomValue(tagsDataAtom);

  const tasksQuery = useQuery({
    ...tasksQueryOptions(orpc),
    placeholderData: keepPreviousData,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
  });

  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      const results = await orpc.tasks.create(encoded);
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onError: (err, _variables, context) => {
      notifyError?.(err);
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
    onError: (err, _variables, context) => {
      notifyError?.(err);
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
      // Optimistic for scope "this" (one task). A "following" save that sets
      // a status applies it to this task alone (the server keeps it), so
      // that status shows at once too; the rest waits for the server.
      if (scope !== "this" && task.status === undefined) {
        return { previousTasks: undefined };
      }
      const optimistic: TaskUpdateDecoded =
        scope === "this" ? task : { status: task.status };

      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previousTasks =
        queryClient.getQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY);

      queryClient.setQueryData<TaskSelectDecoded[]>(TASKS_QUERY_KEY, (old) =>
        old?.map((t) => {
          if (t.id !== id) {
            return t;
          }

          const nextTags =
            optimistic.tagIds === undefined
              ? t.tags
              : tags.filter((tag) =>
                  (optimistic.tagIds ?? []).includes(tag.id)
                );

          return {
            ...t,
            ...optimistic,
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

  const deleteTask = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: DeleteScope }) =>
      await orpc.tasks.delete({ id, scope }),
    onError: (err, _variables, context) => {
      notifyError?.(err);
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

  const parseLink = useMutation({
    mutationFn: async (url: string) => await orpc.tasks.parseLink({ url }),
  });

  return { createTask, deleteTask, parseLink, tasksQuery, updateTask };
}
