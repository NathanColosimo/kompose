import type { TaskInsert } from "@kompose/db/schema/task";
import { implement, ORPCError } from "@orpc/server";
import { Effect, type ParseResult } from "effect";
import { requireAuth } from "../..";
import { type TaskRepositoryError, Tasks, TasksLive } from "./client";
import { taskContract } from "./contract";

function handleError(
  error: TaskRepositoryError | ParseResult.ParseError
): never {
  switch (error._tag) {
    case "TaskRepositoryError":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error.message || "Task operation failed",
        data: {
          cause: error.cause,
        },
      });
    case "ParseError":
      throw new ORPCError("PARSE_ERROR", {
        message: "Failed to parse data",
        data: {
          cause: error.cause,
        },
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "An unexpected error occurred",
      });
  }
}

const os = implement(taskContract).use(requireAuth);

export const taskRouter = os.router({
  list: os.list.handler(({ context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      const tasks = yield* service.listTasks(context.user.id);
      return tasks;
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
      const taskInput: TaskInsert = { ...input, userId: context.user.id };
      const task = yield* service.createTask(context.user.id, taskInput);
      return task;
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),

  update: os.update.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      const task = yield* service.updateTask(
        context.user.id,
        input.id,
        input.task
      );
      return task;
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),

  delete: os.delete.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tasks;
      return yield* service.deleteTask(context.user.id, input.id);
    }).pipe(Effect.provide(TasksLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),
});
