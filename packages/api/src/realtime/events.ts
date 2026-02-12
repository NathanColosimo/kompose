import z from "zod";

export const GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID = "__calendar_list__";

export const syncEventTypeSchema = z.enum([
  "google-calendar",
  "tasks",
  "ai-chat",
  "reconnect",
]);

export const googleCalendarSyncEventSchema = z.object({
  type: z.literal("google-calendar"),
  payload: z
    .object({
      accountId: z.string().min(1),
      calendarId: z.string().min(1),
    })
    .strict(),
});

export const tasksSyncEventSchema = z.object({
  type: z.literal("tasks"),
  payload: z.object({}).strict(),
});

export const aiChatSyncEventSchema = z.object({
  type: z.literal("ai-chat"),
  payload: z
    .object({
      sessionId: z.uuidv7(),
    })
    .strict(),
});

export const reconnectSyncEventSchema = z.object({
  type: z.literal("reconnect"),
  payload: z.object({}).strict(),
});

export const syncEventSchema = z.discriminatedUnion("type", [
  googleCalendarSyncEventSchema,
  tasksSyncEventSchema,
  aiChatSyncEventSchema,
  reconnectSyncEventSchema,
]);

export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncEventType = SyncEvent["type"];
export type GoogleCalendarSyncEvent = z.infer<
  typeof googleCalendarSyncEventSchema
>;
export type TasksSyncEvent = z.infer<typeof tasksSyncEventSchema>;
export type AiChatSyncEvent = z.infer<typeof aiChatSyncEventSchema>;
export type ReconnectSyncEvent = z.infer<typeof reconnectSyncEventSchema>;
