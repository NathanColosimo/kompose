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
import { orpc } from "@/utils/orpc";

/**
 * Query key for tasks.
 *
 * We keep this stable and shared between query + mutations so invalidation is
 * reliable.
 */
const TASKS_KEY = ["tasks", "list"] as const;

/**
 * Minimal tasks hook for native.
 *
 * Differences from the web hook:
 * - We keep it online-first and keep optimistic updates minimal (invalidate on success).
 * - We still decode/encode with the shared codecs so the app works with Temporal
 *   types (`PlainDate`, `PlainTime`, `Instant`) on the UI side.
 */
export function useTasks() {
  const queryClient = useQueryClient();

  const tasksQuery = useQuery({
    queryKey: TASKS_KEY,
    queryFn: async (): Promise<TaskSelectDecoded[]> => {
      const tasks = await orpc.tasks.list.call();
      return tasks.map((t) => taskSelectCodec.parse(t));
    },
    staleTime: 60_000,
  });

  const createTask = useMutation({
    mutationFn: async (task: ClientTaskInsertDecoded) => {
      const encoded = clientTaskInsertCodec.encode(task);
      const results = await orpc.tasks.create.call(encoded);
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
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
      const results = await orpc.tasks.update.call({
        id,
        task: encoded,
        scope,
      });
      return results.map((t) => taskSelectCodec.parse(t));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: DeleteScope }) =>
      await orpc.tasks.delete.call({ id, scope }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });

  return { tasksQuery, createTask, updateTask, deleteTask };
}
