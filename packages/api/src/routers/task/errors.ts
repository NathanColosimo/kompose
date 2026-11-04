import { Schema } from "effect";
import type { PublicError } from "../../errors";

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  "TaskNotFoundError",
  {
    message: Schema.optional(Schema.String),
    taskId: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "NOT_FOUND", message: "Task not found." };
  }
}

export class InvalidTaskError extends Schema.TaggedError<InvalidTaskError>()(
  "InvalidTaskError",
  {
    message: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "BAD_REQUEST", message: this.message };
  }
}
