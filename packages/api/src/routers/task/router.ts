import { implement, ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUserBestEffort } from "../../realtime/sync";
import { TelemetryLive } from "../../telemetry";
import { tagSelectSchemaWithIcon } from "../tag/contract";
import { TaskService } from "./client";
import { taskContract } from "./contract";
import type { TaskError } from "./errors";

const TaskLive = Layer.merge(TaskService.Default, TelemetryLive);

function handleError(error: TaskError): never {
  switch (error._tag) {
    case "TaskRepositoryError":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error.message ?? "Task operation failed",
        data: { cause: error.cause },
      });
    case "TaskNotFoundError":
      throw new ORPCError("NOT_FOUND", {
        message: `Task not found: ${error.taskId}`,
      });
    case "InvalidTaskError":
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "An unexpected error occurred",
      });
  }
}

const os = implement(taskContract).use(requireAuth).use(globalRateLimit);

const normalizeTaskTags = <T extends { tags: Array<{ icon: string }> }>(
  task: T
) => ({
  ...task,
  tags: task.tags.map((tag) => tagSelectSchemaWithIcon.parse(tag)),
});

function publishTasksEvent(userId: string) {
  publishToUserBestEffort(userId, {
    type: "tasks",
    payload: {},
  });
}

export const taskRouter = os.router({
  list: os.list.handler(({ context }) => {
    return Effect.runPromise(
      TaskService.listTasks(context.user.id).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => value,
          onFailure: handleError,
        })
      )
    );
  }),

  create: os.create.handler(({ input, context }) => {
    return Effect.runPromise(
      TaskService.createTask(context.user.id, {
        ...input,
        userId: context.user.id,
      }).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => {
            publishTasksEvent(context.user.id);
            return value;
          },
          onFailure: handleError,
        })
      )
    );
  }),

  update: os.update.handler(({ input, context }) => {
    return Effect.runPromise(
      TaskService.updateTask(
        context.user.id,
        input.id,
        input.task,
        input.scope
      ).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => {
            publishTasksEvent(context.user.id);
            return value;
          },
          onFailure: handleError,
        })
      )
    );
  }),

  delete: os.delete.handler(({ input, context }) => {
    return Effect.runPromise(
      TaskService.deleteTask(context.user.id, input.id, input.scope).pipe(
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => {
            publishTasksEvent(context.user.id);
            return value;
          },
          onFailure: handleError,
        })
      )
    );
  }),
});
