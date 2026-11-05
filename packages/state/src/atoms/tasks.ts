import type { AppRouterClient } from "@kompose/api/routers/index";
import { taskSelectCodec } from "@kompose/api/routers/task/contract";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig } from "../config";

export const TASKS_QUERY_KEY = ["tasks", "list"] as const;

/** Tasks query shared by the atom below and `useTasks`. */
export function tasksQueryOptions(orpc: AppRouterClient) {
  return {
    queryFn: async () => {
      const tasks = await orpc.tasks.list();
      return tasks.map((task) => taskSelectCodec.parse(task));
    },
    queryKey: TASKS_QUERY_KEY,
    staleTime: 1000 * 60 * 5,
  };
}

export const tasksQueryAtom = atomWithQuery((get) =>
  tasksQueryOptions(getStateConfig(get).orpc)
);
