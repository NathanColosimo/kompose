import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import type z from "zod";
import { user } from "./auth";

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
]);

export const taskTable = pgTable("task", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").default("todo").notNull(),
  dueDate: timestamp("due_date"),
  startDate: timestamp("start_date"),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const taskSelectSchema = createSelectSchema(taskTable);
export const taskInsertSchema = createInsertSchema(taskTable);
export const taskUpdateSchema = createUpdateSchema(taskTable);

export type TaskSelect = typeof taskTable.$inferSelect;
export type TaskInsert = typeof taskTable.$inferInsert;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
