import { Schema } from "effect";

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  "TaskNotFoundError",
  {
    taskId: Schema.String,
  },
  { httpApiStatus: 404 }
) {
  override get message() {
    return `Task not found: ${this.taskId}`;
  }
}

export class InvalidTaskError extends Schema.TaggedError<InvalidTaskError>()(
  "InvalidTaskError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 }
) {}

export type TaskError = TaskNotFoundError | InvalidTaskError;
