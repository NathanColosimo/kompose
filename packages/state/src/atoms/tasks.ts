import {
  type TaskSelectDecoded,
  taskSelectCodec,
} from "@kompose/api/routers/task/contract";
import { atom } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { getStateConfig, hasSessionAtom } from "../config";

/** Shared query key for tasks. */
export const TASKS_QUERY_KEY = ["tasks", "list"] as const;

/**
 * Tasks query atom for shared data access across app surfaces.
 */
export const tasksQueryAtom = atomWithQuery<TaskSelectDecoded[]>((get) => {
  const { orpc } = getStateConfig(get);
  const hasSession = get(hasSessionAtom);

  return {
    queryKey: TASKS_QUERY_KEY,
    enabled: hasSession,
    queryFn: async () => {
      const tasks = await orpc.tasks.list.call();
      return tasks.map((task) => taskSelectCodec.parse(task));
    },
    staleTime: 1000 * 60 * 5,
  };
});

/**
 * Convenience atom for just the task data.
 */
export const tasksDataAtom = atom((get) => get(tasksQueryAtom).data ?? []);
