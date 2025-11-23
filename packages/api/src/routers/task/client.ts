import { db } from "@kompose/db";
import { task } from "@kompose/db/schema/task";
import { and, desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { type CreateTaskInput, Task, type UpdateTaskInput } from "./schema";

// Error types
export class TaskRepositoryError extends Data.TaggedError(
  "TaskRepositoryError"
)<{
  cause: unknown;
  message?: string;
}> {}

// Service Definition
export type TaskService = {
  readonly listTasks: (
    userId: string
  ) => Effect.Effect<readonly (typeof Task.Type)[], TaskRepositoryError>;
  readonly createTask: (
    userId: string,
    input: typeof CreateTaskInput.Type
  ) => Effect.Effect<typeof Task.Type, TaskRepositoryError>;
  readonly updateTask: (
    userId: string,
    taskId: string,
    input: typeof UpdateTaskInput.Type
  ) => Effect.Effect<typeof Task.Type, TaskRepositoryError>;
  readonly deleteTask: (
    userId: string,
    taskId: string
  ) => Effect.Effect<void, TaskRepositoryError>;
};

export class Tasks extends Context.Tag("Tasks")<Tasks, TaskService>() {}

// Implementation
const make = (): TaskService => {
  const listTasks = (userId: string) =>
    Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(task)
          .where(eq(task.userId, userId))
          .orderBy(desc(task.createdAt)),
      catch: (cause) => {
        console.error(cause);
        return new TaskRepositoryError({ cause });
      },
    }).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknown(Schema.Array(Task))(rows).pipe(
          Effect.mapError((e) => new TaskRepositoryError({ cause: e }))
        )
      )
    );

  const createTask = (userId: string, input: typeof CreateTaskInput.Type) =>
    Effect.tryPromise({
      try: () =>
        db
          .insert(task)
          .values({ ...input, userId })
          .returning(),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }).pipe(
      Effect.map((rows) => rows[0]),
      Effect.flatMap((row) =>
        Schema.decodeUnknown(Task)(row).pipe(
          Effect.mapError((e) => new TaskRepositoryError({ cause: e }))
        )
      )
    );

  const updateTask = (
    userId: string,
    taskId: string,
    input: typeof UpdateTaskInput.Type
  ) =>
    Effect.tryPromise({
      try: () =>
        db
          .update(task)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(task.id, taskId), eq(task.userId, userId)))
          .returning(),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }).pipe(
      Effect.map((rows) => rows[0]),
      Effect.flatMap((row) => {
        if (!row) {
          return Effect.fail(
            new TaskRepositoryError({ cause: "Task not found" })
          );
        }
        return Schema.decodeUnknown(Task)(row).pipe(
          Effect.mapError((e) => new TaskRepositoryError({ cause: e }))
        );
      })
    );

  const deleteTask = (userId: string, taskId: string) =>
    Effect.tryPromise({
      try: () =>
        db
          .delete(task)
          .where(and(eq(task.id, taskId), eq(task.userId, userId))),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }).pipe(Effect.asVoid);

  return {
    listTasks,
    createTask,
    updateTask,
    deleteTask,
  };
};

export const TasksLive = Layer.succeed(Tasks, make());
