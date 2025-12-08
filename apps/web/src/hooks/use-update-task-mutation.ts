"use client";

import type { TaskSelect } from "@kompose/db/schema/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/**
 * Task update mutation with optimistic cache patch and rollback.
 */
export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.tasks.update.mutationOptions(),
    onMutate: async ({ id, task }) => {
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
  });
}
