import { oc } from "@orpc/contract";
import { Schema } from "effect";
import { CreateTaskInput, Task, UpdateTaskInput } from "./schema";

export const listTasks = oc.output(Schema.standardSchemaV1(Schema.Array(Task)));

export const createTask = oc
  .input(Schema.standardSchemaV1(CreateTaskInput))
  .output(Schema.standardSchemaV1(Task));

export const updateTask = oc
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        id: Schema.UUID,
        task: UpdateTaskInput,
      })
    )
  )
  .output(Schema.standardSchemaV1(Task));

export const deleteTask = oc
  .input(Schema.standardSchemaV1(Schema.Struct({ id: Schema.UUID })))
  .output(Schema.standardSchemaV1(Schema.Void));

export const taskContract = {
  list: listTasks,
  create: createTask,
  update: updateTask,
  delete: deleteTask,
};
