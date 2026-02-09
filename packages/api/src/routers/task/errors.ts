import { Schema } from "effect";

export class TaskRepositoryError extends Schema.TaggedError<TaskRepositoryError>()(
  "TaskRepositoryError",
  {
    cause: Schema.Unknown,
    message: Schema.optional(Schema.String),
  }
) {}

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  "TaskNotFoundError",
  {
    taskId: Schema.String,
    message: Schema.optional(Schema.String),
  }
) {}

export class InvalidTaskError extends Schema.TaggedError<InvalidTaskError>()(
  "InvalidTaskError",
  {
    message: Schema.String,
  }
) {}

export type TaskError =
  | TaskRepositoryError
  | TaskNotFoundError
  | InvalidTaskError;
