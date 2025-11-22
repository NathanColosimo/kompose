import { implement, ORPCError } from "@orpc/server";
import { Effect, type ParseResult, Schema } from "effect";
import { requireAuth } from "../..";
import { type TaskRepositoryError, Tasks, TasksLive } from "./client";
import { taskContract } from "./contract";
import { Task } from "./schema";

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
      return yield* Schema.encode(Schema.Array(Task))(tasks);
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
      // input is already validated and parsed to domain objects (Dates) by oRPC middleware
      const task = yield* service.createTask(context.user.id, input);
      return yield* Schema.encode(Task)(task);
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
      return yield* Schema.encode(Task)(task);
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
