import {
  taskInsertSchema,
  taskSelectSchema,
  taskUpdateSchema,
} from "@kompose/db/schema/task";
import { oc } from "@orpc/contract";
import z from "zod";

export const listTasks = oc.input(z.void()).output(z.array(taskSelectSchema));

export const createTask = oc.input(taskInsertSchema).output(taskSelectSchema);

export const updateTask = oc
  .input(
    z.object({
      id: z.uuidv7(),
      task: taskUpdateSchema,
    })
  )
  .output(taskSelectSchema);

export const deleteTask = oc
  .input(z.object({ id: z.uuidv7() }))
  .output(z.void());

export const taskContract = {
  list: listTasks,
  create: createTask,
  update: updateTask,
  delete: deleteTask,
};
