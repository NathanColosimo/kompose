import { Schema } from "effect";

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

export type TaskError = TaskNotFoundError | InvalidTaskError;
