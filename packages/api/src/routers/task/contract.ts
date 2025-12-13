import {
  taskInsertSchema,
  taskSelectSchema,
  taskUpdateSchema,
} from "@kompose/db/schema/task";
import { oc } from "@orpc/contract";
import z from "zod";

export const listTasks = oc.input(z.void()).output(z.array(taskSelectSchema));

/** Client-facing insert schema omits userId (added from auth context on server) */
export const clientTaskInsertSchema = taskInsertSchema.omit({ userId: true });
export type ClientTaskInsert = z.infer<typeof clientTaskInsertSchema>;

export const createTask = oc
  .input(clientTaskInsertSchema)
  .output(taskSelectSchema);

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
