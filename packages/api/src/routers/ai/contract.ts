import {
  aiMessageSelectSchema,
  aiSessionInsertSchema,
  aiSessionSelectSchema,
} from "@kompose/db/schema/ai";
import { eventIterator, oc } from "@orpc/contract";
import type { UIMessage, UIMessageChunk } from "ai";
import z from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const uiMessageSchema: z.ZodType<UIMessage> = z.custom<UIMessage>((value) => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.role === "string" && Array.isArray(value.parts);
});

const uiMessageChunkSchema: z.ZodType<UIMessageChunk> =
  z.custom<UIMessageChunk>();

export const createAiSessionInputSchema = aiSessionInsertSchema.pick({
  title: true,
  model: true,
});
export type CreateAiSessionInput = z.infer<typeof createAiSessionInputSchema>;

export const deleteAiSessionInputSchema = z.object({
  sessionId: z.uuidv7(),
});
export type DeleteAiSessionInput = z.infer<typeof deleteAiSessionInputSchema>;

export const listAiMessagesInputSchema = z.object({
  sessionId: z.uuidv7(),
});
export type ListAiMessagesInput = z.infer<typeof listAiMessagesInputSchema>;

export const sendAiStreamInputSchema = z.object({
  sessionId: z.uuidv7(),
  message: uiMessageSchema,
});
export type SendAiStreamInput = z.infer<typeof sendAiStreamInputSchema>;

export const reconnectAiStreamInputSchema = z.object({
  sessionId: z.uuidv7(),
});
export type ReconnectAiStreamInput = z.infer<
  typeof reconnectAiStreamInputSchema
>;

const listSessions = oc.input(z.void()).output(z.array(aiSessionSelectSchema));

const createSession = oc
  .input(createAiSessionInputSchema)
  .output(aiSessionSelectSchema);

const deleteSession = oc.input(deleteAiSessionInputSchema).output(z.void());

const listMessages = oc
  .input(listAiMessagesInputSchema)
  .output(z.array(aiMessageSelectSchema));

const sendStream = oc
  .input(sendAiStreamInputSchema)
  .output(eventIterator(uiMessageChunkSchema));

const reconnectStream = oc
  .input(reconnectAiStreamInputSchema)
  .output(eventIterator(uiMessageChunkSchema));

export const aiContract = {
  sessions: {
    list: listSessions,
    create: createSession,
    delete: deleteSession,
  },
  messages: {
    list: listMessages,
  },
  stream: {
    send: sendStream,
    reconnect: reconnectStream,
  },
};
