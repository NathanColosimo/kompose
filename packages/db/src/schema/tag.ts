import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import type { infer as ZodInfer } from "zod";
import { user } from "./auth";
import { taskTable } from "./task";

export const tagTable = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lucide icon name for the tag */
    icon: text("icon").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("tag_user_name_unique").on(table.userId, table.name),
    index("tag_user_idx").on(table.userId),
  ]
);

export const taskTagTable = pgTable(
  "task_tag",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tagTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tagId] }),
    index("task_tag_task_id_idx").on(table.taskId),
    index("task_tag_tag_id_idx").on(table.tagId),
  ]
);

export const tagSelectSchema = createSelectSchema(tagTable);
export const tagInsertSchema = createInsertSchema(tagTable).omit({ id: true });
export const tagUpdateSchema = createUpdateSchema(tagTable);

export type TagSelect = ZodInfer<typeof tagSelectSchema>;
export type TagInsert = ZodInfer<typeof tagInsertSchema>;
export type TagUpdate = ZodInfer<typeof tagUpdateSchema>;

export type TagInsertRow = typeof tagTable.$inferInsert;
export type TaskTagInsert = typeof taskTagTable.$inferInsert;
