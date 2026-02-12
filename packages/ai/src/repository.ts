import { db } from "@kompose/db";
import {
  type AiChatRole,
  type AiMessageInsertRow,
  type AiMessageSelect,
  type AiSessionInsertRow,
  type AiSessionSelect,
  aiMessageSelectSchema,
  aiMessageTable,
  aiSessionTable,
  type CreateAiMessageInput,
  type CreateAiSessionInput,
} from "@kompose/db/schema/ai";
import { and, asc, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { uuidv7 } from "uuidv7";
import { AiChatError } from "./errors";

export class AiChatRepository extends Effect.Service<AiChatRepository>()(
  "AiChatRepository",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const listSessions: (
        userId: string
      ) => Effect.Effect<AiSessionSelect[], AiChatError> = Effect.fn(
        "AiChatRepository.listSessions"
      )(function* (userId: string) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(aiSessionTable)
              .where(eq(aiSessionTable.userId, userId))
              .orderBy(desc(aiSessionTable.lastMessageAt)),
          catch: () =>
            new AiChatError({
              message: "Failed to list chat sessions.",
              code: "INTERNAL",
            }),
        });
      });

      const createSession: (
        userId: string,
        input: CreateAiSessionInput
      ) => Effect.Effect<AiSessionSelect, AiChatError> = Effect.fn(
        "AiChatRepository.createSession"
      )(function* (userId: string, input: CreateAiSessionInput) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        const insert: AiSessionInsertRow = {
          id: uuidv7(),
          userId,
          title: input.title ?? null,
          model: input.model ?? null,
          activeStreamId: null,
          lastMessageAt: new Date().toISOString(),
        };

        const [row] = yield* Effect.tryPromise({
          try: () => db.insert(aiSessionTable).values(insert).returning(),
          catch: () =>
            new AiChatError({
              message: "Failed to create chat session.",
              code: "INTERNAL",
            }),
        });

        if (!row) {
          return yield* new AiChatError({
            message: "Failed to create chat session.",
            code: "INTERNAL",
          });
        }
        return row;
      });

      const getSession: (
        userId: string,
        sessionId: string
      ) => Effect.Effect<AiSessionSelect, AiChatError> = Effect.fn(
        "AiChatRepository.getSession"
      )(function* (userId: string, sessionId: string) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        const [row] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(aiSessionTable)
              .where(
                and(
                  eq(aiSessionTable.id, sessionId),
                  eq(aiSessionTable.userId, userId)
                )
              ),
          catch: () =>
            new AiChatError({
              message: "Failed to get chat session.",
              code: "INTERNAL",
            }),
        });

        if (!row) {
          return yield* Effect.fail(
            new AiChatError({
              message: "Chat session not found.",
              code: "NOT_FOUND",
            })
          );
        }
        return row;
      });

      const deleteSession: (
        userId: string,
        sessionId: string
      ) => Effect.Effect<void, AiChatError> = Effect.fn(
        "AiChatRepository.deleteSession"
      )(function* (userId: string, sessionId: string) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .delete(aiSessionTable)
              .where(
                and(
                  eq(aiSessionTable.id, sessionId),
                  eq(aiSessionTable.userId, userId)
                )
              )
              .returning({ id: aiSessionTable.id }),
          catch: () =>
            new AiChatError({
              message: "Failed to delete chat session.",
              code: "INTERNAL",
            }),
        });

        if (rows.length === 0) {
          return yield* new AiChatError({
            message: "Chat session not found.",
            code: "NOT_FOUND",
          });
        }
      });

      const listMessages: (
        sessionId: string
      ) => Effect.Effect<AiMessageSelect[], AiChatError> = Effect.fn(
        "AiChatRepository.listMessages"
      )(function* (sessionId: string) {
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(aiMessageTable)
              .where(eq(aiMessageTable.sessionId, sessionId))
              .orderBy(asc(aiMessageTable.createdAt)),
          catch: () =>
            new AiChatError({
              message: "Failed to list chat messages.",
              code: "INTERNAL",
            }),
        });

        const parsedRows = aiMessageSelectSchema.array().safeParse(rows);
        if (!parsedRows.success) {
          return yield* new AiChatError({
            message: "Failed to parse chat messages.",
            code: "INTERNAL",
          });
        }

        return parsedRows.data;
      });

      const createMessage: (
        input: CreateAiMessageInput
      ) => Effect.Effect<AiMessageSelect, AiChatError> = Effect.fn(
        "AiChatRepository.createMessage"
      )(function* (input: {
        sessionId: string;
        role: AiChatRole;
        content: string;
        parts?: CreateAiMessageInput["parts"];
      }) {
        yield* Effect.annotateCurrentSpan("sessionId", input.sessionId);
        const insert: AiMessageInsertRow = {
          id: uuidv7(),
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          parts: input.parts,
        };

        const [row] = yield* Effect.tryPromise({
          try: () => db.insert(aiMessageTable).values(insert).returning(),
          catch: () =>
            new AiChatError({
              message: "Failed to create chat message.",
              code: "INTERNAL",
            }),
        });

        if (!row) {
          return yield* new AiChatError({
            message: "Failed to create chat message.",
            code: "INTERNAL",
          });
        }
        const parsedRow = aiMessageSelectSchema.safeParse(row);
        if (!parsedRow.success) {
          return yield* new AiChatError({
            message: "Failed to parse chat message.",
            code: "INTERNAL",
          });
        }

        return parsedRow.data;
      });

      const updateSessionActivity: (input: {
        userId: string;
        sessionId: string;
        activeStreamId?: string | null;
        title?: string | null;
      }) => Effect.Effect<void, AiChatError> = Effect.fn(
        "AiChatRepository.updateSessionActivity"
      )(function* (input: {
        userId: string;
        sessionId: string;
        activeStreamId?: string | null;
        title?: string | null;
      }) {
        yield* Effect.annotateCurrentSpan("userId", input.userId);
        yield* Effect.annotateCurrentSpan("sessionId", input.sessionId);
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(aiSessionTable)
              .set({
                activeStreamId: input.activeStreamId,
                title: input.title,
                lastMessageAt: new Date().toISOString(),
              })
              .where(
                and(
                  eq(aiSessionTable.id, input.sessionId),
                  eq(aiSessionTable.userId, input.userId)
                )
              ),
          catch: () =>
            new AiChatError({
              message: "Failed to update chat session.",
              code: "INTERNAL",
            }),
        });
      });

      return {
        listSessions,
        createSession,
        getSession,
        deleteSession,
        listMessages,
        createMessage,
        updateSessionActivity,
      };
    }),
  }
) {}
