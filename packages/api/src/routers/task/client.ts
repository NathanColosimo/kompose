import { db } from "@kompose/db";
import {
  type TaskInsert,
  type TaskSelect,
  type TaskUpdate,
  taskTable,
} from "@kompose/db/schema/task";
import { and, desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
// Error types
export class TaskRepositoryError extends Data.TaggedError(
  "TaskRepositoryError"
)<{
  cause: unknown;
  message?: string;
}> {}

// Service Definition
export interface TaskService {
  readonly listTasks: (
    userId: string
  ) => Effect.Effect<TaskSelect[], TaskRepositoryError>;
  readonly createTask: (
    userId: string,
    input: TaskInsert
  ) => Effect.Effect<TaskSelect, TaskRepositoryError>;
  readonly updateTask: (
    userId: string,
    taskId: string,
    input: TaskUpdate
  ) => Effect.Effect<TaskSelect, TaskRepositoryError>;
  readonly deleteTask: (
    userId: string,
    taskId: string
  ) => Effect.Effect<void, TaskRepositoryError>;
}

export class Tasks extends Context.Tag("Tasks")<Tasks, TaskService>() {}

// Implementation
const taskService: TaskService = {
  listTasks: (userId) =>
    Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(taskTable)
          .where(eq(taskTable.userId, userId))
          .orderBy(desc(taskTable.createdAt)),
      catch: (cause) => {
        console.error(cause);
        return new TaskRepositoryError({ cause });
      },
    }),

  createTask: (userId, input) =>
    Effect.tryPromise({
      try: () =>
        db
          .insert(taskTable)
          .values({ ...input, id: uuidv7(), userId })
          .returning(),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(rows[0])
          : Effect.fail(
              new TaskRepositoryError({
                message: "Failed to create task",
                cause: "No result returned",
              })
            )
      )
    ),

  updateTask: (userId, taskId, input) =>
    Effect.tryPromise({
      try: () =>
        db
          .update(taskTable)
          .set(input)
          .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)))
          .returning(),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(rows[0])
          : Effect.fail(
              new TaskRepositoryError({
                message: "Task not found",
                cause: "No result returned",
              })
            )
      )
    ),

  deleteTask: (userId, taskId) =>
    Effect.tryPromise({
      try: () =>
        db
          .delete(taskTable)
          .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId))),
      catch: (cause) => new TaskRepositoryError({ cause }),
    }),
};

export const TasksLive = Layer.succeed(Tasks, taskService);
