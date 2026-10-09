import { defineRelations } from "drizzle-orm";
import { tagTable, taskTagTable } from "./tag";
import { taskTable } from "./task";

const relationalSchema = {
  tagTable,
  taskTable,
  taskTagTable,
};

export const relations = defineRelations(relationalSchema, (r) => ({
  tagTable: {
    taskTags: r.many.taskTagTable({
      from: r.tagTable.id,
      to: r.taskTagTable.tagId,
    }),
  },
  taskTable: {
    taskTags: r.many.taskTagTable({
      from: r.taskTable.id,
      to: r.taskTagTable.taskId,
    }),
  },
  taskTagTable: {
    tag: r.one.tagTable({
      from: r.taskTagTable.tagId,
      optional: false,
      to: r.tagTable.id,
    }),
    task: r.one.taskTable({
      from: r.taskTagTable.taskId,
      optional: false,
      to: r.taskTable.id,
    }),
  },
}));
