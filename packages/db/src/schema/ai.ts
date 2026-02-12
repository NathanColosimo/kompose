import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import type { infer as ZodInfer } from "zod";
import { user } from "./auth";

/**
 * Chat role enum intentionally includes future roles (system/tool)
 * so Phase 2 tool-calling can be added without changing this enum.
 */
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "system",
  "user",
  "assistant",
  "tool",
]);

/**
 * Canonical chat session table. One row represents one conversation thread
 * scoped to a single authenticated user.
 */
export const aiSessionTable = pgTable(
  "ai_session",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Optional model identifier to preserve provider/model history per session. */
    model: text("model"),
    /** Optional active stream pointer used for reconnect/resume lookup. */
    activeStreamId: text("active_stream_id"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date().toISOString()),
    lastMessageAt: timestamp("last_message_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_session_user_id_idx").on(table.userId),
    index("ai_session_user_last_message_idx").on(
      table.userId,
      table.lastMessageAt
    ),
  ]
);

/**
 * Message table stores normalized chat records.
 * User ownership is inherited from session.
 * We keep text content plus optional JSON parts for rich/generative payloads.
 */
export const aiMessageTable = pgTable(
  "ai_message",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => aiSessionTable.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    /**
     * Provider-specific structured parts (e.g. AI SDK message parts, tool UI parts).
     * Keep this aligned with AI SDK UIMessage parts.
     */
    parts: jsonb("parts"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_message_session_created_idx").on(
      table.sessionId,
      table.createdAt
    ),
  ]
);

export const aiSessionSelectSchema = createSelectSchema(aiSessionTable);
export const aiSessionInsertSchema = createInsertSchema(aiSessionTable).omit({
  id: true,
});
export const aiSessionUpdateSchema = createUpdateSchema(aiSessionTable);

export const aiMessageSelectSchema = createSelectSchema(aiMessageTable);
export const aiMessageInsertSchema = createInsertSchema(aiMessageTable).omit({
  id: true,
});
export const aiMessageUpdateSchema = createUpdateSchema(aiMessageTable);

export type AiSessionSelect = ZodInfer<typeof aiSessionSelectSchema>;
export type AiSessionInsert = ZodInfer<typeof aiSessionInsertSchema>;
export type AiSessionUpdate = ZodInfer<typeof aiSessionUpdateSchema>;

export type AiMessageSelect = ZodInfer<typeof aiMessageSelectSchema>;
export type AiMessageInsert = ZodInfer<typeof aiMessageInsertSchema>;
export type AiMessageUpdate = ZodInfer<typeof aiMessageUpdateSchema>;

export type AiSessionInsertRow = typeof aiSessionTable.$inferInsert;
export type AiMessageInsertRow = typeof aiMessageTable.$inferInsert;

export type AiChatRole = AiMessageSelect["role"];
export type CreateAiSessionInput = Pick<AiSessionInsert, "title" | "model">;
export type CreateAiMessageInput = Pick<
  AiMessageInsert,
  "sessionId" | "role" | "content" | "parts"
>;
