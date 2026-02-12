import { relations } from "drizzle-orm";
import { aiMessageTable, aiSessionTable } from "./ai";
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

export const aiSessionRelations = relations(aiSessionTable, ({ many }) => ({
  messages: many(aiMessageTable),
}));

export const aiMessageRelations = relations(aiMessageTable, ({ one }) => ({
  session: one(aiSessionTable, {
    fields: [aiMessageTable.sessionId],
    references: [aiSessionTable.id],
  }),
}));
