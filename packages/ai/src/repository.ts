import { Database, DatabaseLive } from "@kompose/db";
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
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import { uuidv7 } from "uuidv7";
import { AiChatError } from "./errors";

export class AiChatRepository extends Effect.Service<AiChatRepository>()(
  "AiChatRepository",
  {
    accessors: true,
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const db = yield* Database;

      const listSessions: (
        userId: string
      ) => Effect.Effect<AiSessionSelect[], EffectDrizzleQueryError> =
        Effect.fn("AiChatRepository.listSessions")(function* (userId: string) {
          yield* Effect.annotateCurrentSpan("userId", userId);
          return yield* db
            .select()
            .from(aiSessionTable)
            .where(eq(aiSessionTable.userId, userId))
            .orderBy(desc(aiSessionTable.lastMessageAt));
        });

      const createSession: (
        userId: string,
        input: CreateAiSessionInput
      ) => Effect.Effect<
        AiSessionSelect,
        AiChatError | EffectDrizzleQueryError
      > = Effect.fn("AiChatRepository.createSession")(function* (
        userId: string,
        input: CreateAiSessionInput
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        const insert: AiSessionInsertRow = {
          id: uuidv7(),
          userId,
          title: input.title ?? null,
          model: input.model ?? null,
          activeStreamId: null,
          lastMessageAt: new Date().toISOString(),
        };

        const [row] = yield* db
          .insert(aiSessionTable)
          .values(insert)
          .returning();

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
      ) => Effect.Effect<
        AiSessionSelect,
        AiChatError | EffectDrizzleQueryError
      > = Effect.fn("AiChatRepository.getSession")(function* (
        userId: string,
        sessionId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        const [row] = yield* db
          .select()
          .from(aiSessionTable)
          .where(
            and(
              eq(aiSessionTable.id, sessionId),
              eq(aiSessionTable.userId, userId)
            )
          );

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
      ) => Effect.Effect<void, AiChatError | EffectDrizzleQueryError> =
        Effect.fn("AiChatRepository.deleteSession")(function* (
          userId: string,
          sessionId: string
        ) {
          yield* Effect.annotateCurrentSpan("userId", userId);
          yield* Effect.annotateCurrentSpan("sessionId", sessionId);
          const rows = yield* db
            .delete(aiSessionTable)
            .where(
              and(
                eq(aiSessionTable.id, sessionId),
                eq(aiSessionTable.userId, userId)
              )
            )
            .returning({ id: aiSessionTable.id });

          if (rows.length === 0) {
            return yield* new AiChatError({
              message: "Chat session not found.",
              code: "NOT_FOUND",
            });
          }
        });

      const listMessages: (
        userId: string,
        sessionId: string
      ) => Effect.Effect<
        AiMessageSelect[],
        AiChatError | EffectDrizzleQueryError
      > = Effect.fn("AiChatRepository.listMessages")(function* (
        userId: string,
        sessionId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        const rows = yield* db
          .select({ message: aiMessageTable })
          .from(aiMessageTable)
          .innerJoin(
            aiSessionTable,
            and(
              eq(aiSessionTable.id, aiMessageTable.sessionId),
              eq(aiSessionTable.userId, userId)
            )
          )
          .where(eq(aiMessageTable.sessionId, sessionId))
          .orderBy(asc(aiMessageTable.createdAt));

        const messages = rows.map((row) => row.message);
        const parsedRows = aiMessageSelectSchema.array().safeParse(messages);
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
      ) => Effect.Effect<
        AiMessageSelect,
        AiChatError | EffectDrizzleQueryError
      > = Effect.fn("AiChatRepository.createMessage")(function* (input: {
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

        const [row] = yield* db
          .insert(aiMessageTable)
          .values(insert)
          .returning();

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
      }) => Effect.Effect<void, EffectDrizzleQueryError> = Effect.fn(
        "AiChatRepository.updateSessionActivity"
      )(function* (input: {
        userId: string;
        sessionId: string;
        activeStreamId?: string | null;
        title?: string | null;
      }) {
        yield* Effect.annotateCurrentSpan("userId", input.userId);
        yield* Effect.annotateCurrentSpan("sessionId", input.sessionId);
        yield* db
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
          );
      });

      const updateMessageContent: (input: {
        messageId: string;
        content: string;
        parts?: CreateAiMessageInput["parts"];
      }) => Effect.Effect<void, EffectDrizzleQueryError> = Effect.fn(
        "AiChatRepository.updateMessageContent"
      )(function* (input: {
        messageId: string;
        content: string;
        parts?: CreateAiMessageInput["parts"];
      }) {
        yield* db
          .update(aiMessageTable)
          .set({ content: input.content, parts: input.parts })
          .where(eq(aiMessageTable.id, input.messageId));
      });

      return {
        listSessions,
        createSession,
        getSession,
        deleteSession,
        listMessages,
        createMessage,
        updateMessageContent,
        updateSessionActivity,
      };
    }),
  }
) {}
