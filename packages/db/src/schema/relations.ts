import { defineRelations } from "drizzle-orm";
import { tagTable, taskTagTable } from "./tag";
import { taskTable } from "./task";

export const relations = defineRelations(
  { tagTable, taskTable, taskTagTable },
  (r) => ({
    taskTable: {
      // A task's tags, joined through task_tag
      tags: r.many.tagTable({
        from: r.taskTable.id.through(r.taskTagTable.taskId),
        to: r.tagTable.id.through(r.taskTagTable.tagId),
      }),
    },
  })
);
