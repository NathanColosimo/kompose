import { relations } from "drizzle-orm";
import { tagTable, taskTagTable } from "./tag";
import { taskTable } from "./task";

export const taskRelations = relations(taskTable, ({ many }) => ({
  taskTags: many(taskTagTable),
}));

export const tagRelations = relations(tagTable, ({ many }) => ({
  taskTags: many(taskTagTable),
}));

export const taskTagRelations = relations(taskTagTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [taskTagTable.taskId],
    references: [taskTable.id],
  }),
  tag: one(tagTable, {
    fields: [taskTagTable.tagId],
    references: [tagTable.id],
  }),
}));
