import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUserBestEffort } from "../../realtime/sync";
import { tagSelectSchemaWithIcon } from "../tag/contract";
import {
  type InvalidTaskError,
  type TaskNotFoundError,
  type TaskRepositoryError,
  Tasks,
  TasksLive,
} from "./client";
import { taskContract } from "./contract";

type TaskError = TaskRepositoryError | TaskNotFoundError | InvalidTaskError;

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
      // Exhaustive check - TypeScript ensures all cases are handled
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
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      const tasks = yield* service.listTasks(context.user.id);
      return tasks.map((task) => normalizeTaskTags(task));
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),

  create: os.create.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      const tasks = yield* service.createTask(context.user.id, {
        ...input,
        userId: context.user.id,
      });
      return tasks.map((task) => normalizeTaskTags(task));
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => {
          publishTasksEvent(context.user.id);
          return res;
        },
        onFailure: (err) => handleError(err),
      })
    );
  }),

  update: os.update.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      const tasks = yield* service.updateTask(
        context.user.id,
        input.id,
        input.task,
        input.scope
      );
      return tasks.map((task) => normalizeTaskTags(task));
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => {
          publishTasksEvent(context.user.id);
          return res;
        },
        onFailure: (err) => handleError(err),
      })
    );
  }),

  delete: os.delete.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      return yield* service.deleteTask(context.user.id, input.id, input.scope);
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => {
          publishTasksEvent(context.user.id);
          return res;
        },
        onFailure: (err) => handleError(err),
      })
    );
  }),
});
