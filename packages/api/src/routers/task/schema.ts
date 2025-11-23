import { Schema } from "effect";

export const TaskStatus = Schema.Literal("todo", "in_progress", "done");

export const Task = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: TaskStatus,
  dueDate: Schema.NullOr(Schema.DateFromSelf),
  startDate: Schema.NullOr(Schema.DateFromSelf),
  startTime: Schema.NullOr(Schema.DateFromSelf),
  endTime: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});

export const CreateTaskInput = Task.pick(
  "title",
  "description",
  "status",
  "dueDate",
  "startDate"
);

export type CreateTask = typeof CreateTaskInput.Type;

export const UpdateTaskInput = Schema.partialWith(CreateTaskInput, {
  exact: true,
});
