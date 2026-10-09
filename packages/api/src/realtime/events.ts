import z from "zod";

export const GOOGLE_CALENDAR_LIST_SYNC_CALENDAR_ID = "__calendar_list__";

export const syncEventTypeSchema = z.enum([
  "google-calendar",
  "tasks",
  "reconnect",
  "keepalive",
]);

export const googleCalendarSyncEventSchema = z.object({
  payload: z
    .object({
      accountId: z.string().min(1),
      calendarId: z.string().min(1),
    })
    .strict(),
  type: z.literal("google-calendar"),
});

export const tasksSyncEventSchema = z.object({
  payload: z.object({}).strict(),
  type: z.literal("tasks"),
});

export const reconnectSyncEventSchema = z.object({
  payload: z.object({}).strict(),
  type: z.literal("reconnect"),
});

export const keepaliveSyncEventSchema = z.object({
  payload: z.object({}).strict(),
  type: z.literal("keepalive"),
});

export const syncEventSchema = z.discriminatedUnion("type", [
  googleCalendarSyncEventSchema,
  tasksSyncEventSchema,
  reconnectSyncEventSchema,
  keepaliveSyncEventSchema,
]);

export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncEventType = SyncEvent["type"];
export type GoogleCalendarSyncEvent = z.infer<
  typeof googleCalendarSyncEventSchema
>;
export type TasksSyncEvent = z.infer<typeof tasksSyncEventSchema>;
export type ReconnectSyncEvent = z.infer<typeof reconnectSyncEventSchema>;
