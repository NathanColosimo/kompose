import { Schema } from "effect";

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  "TaskNotFoundError",
  {
    message: Schema.optional(Schema.String),
    taskId: Schema.String,
  }
) {}

export class InvalidTaskError extends Schema.TaggedError<InvalidTaskError>()(
  "InvalidTaskError",
  {
    message: Schema.String,
  }
) {}

export type TaskError = TaskNotFoundError | InvalidTaskError;
