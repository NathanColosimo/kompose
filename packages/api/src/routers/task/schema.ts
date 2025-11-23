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

export const CreateTaskInput = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(TaskStatus),
  dueDate: Schema.optional(Schema.NullOr(Schema.Date)),
  startDate: Schema.optional(Schema.NullOr(Schema.Date)),
  startTime: Schema.optional(Schema.NullOr(Schema.Date)),
  endTime: Schema.optional(Schema.NullOr(Schema.Date)),
});

export const UpdateTaskInput = Schema.partialWith(CreateTaskInput, {
  exact: true,
});
