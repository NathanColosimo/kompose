import { AiChatError, AiChatService } from "@kompose/ai";
import { DatabaseLive } from "@kompose/db";
import { implement, ORPCError, streamToEventIterator } from "@orpc/server";
import { generateId, toUIMessageStream, type UIMessageChunk } from "ai";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import { TelemetryLive } from "../../telemetry";
import { aiContract } from "./contract";
import { chatResumableStreamContext } from "./resumable-stream";
import {
  sseStringStreamToUiMessageChunkStream,
  uiMessageChunkStreamToSseStringStream,
} from "./stream-protocol";
import { aiToolApproval, createAiTools } from "./tools";

const AiChatLive = Layer.mergeAll(
  AiChatService.layer,
  DatabaseLive,
  TelemetryLive
);

function publishAiChatEvent(userId: string, sessionId: string) {
  return publishToUser(userId, {
    payload: { sessionId },
    type: "ai-chat",
  }).pipe(Effect.catch(() => Effect.void));
}

function emptyUiMessageChunkIterator() {
  return streamToEventIterator(
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.close();
      },
    })
  );
}

function handleError(error: AiChatError | EffectDrizzleQueryError): never {
  if (error._tag === "EffectDrizzleQueryError") {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: error.message,
    });
  }

  const errorData = { aiErrorCode: error.code };

  switch (error.code) {
    case "UNAUTHORIZED":
      throw new ORPCError("UNAUTHORIZED", {
        data: errorData,
        message: error.message,
      });
    case "NOT_FOUND":
      throw new ORPCError("NOT_FOUND", {
        data: errorData,
        message: error.message,
      });
    case "BAD_REQUEST":
      throw new ORPCError("BAD_REQUEST", {
        data: errorData,
        message: error.message,
      });
    case "MODEL_NOT_CONFIGURED":
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        data: errorData,
        message: error.message,
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        data: errorData,
        message: error.message,
      });
  }
}

const os = implement(aiContract).use(requireAuth).use(globalRateLimit);

export const aiRouter = os.router({
  messages: {
    list: os.messages.list.handler(({ input, context }) => {
      const program = AiChatService.use((service) =>
        service.listMessages(context.user.id, input.sessionId)
      );

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      );
    }),
  },
  sessions: {
    create: os.sessions.create.handler(({ input, context }) => {
      const program = AiChatService.use((service) =>
        service.createSession(context.user.id, input)
      );

      return Effect.runPromise(
        program.pipe(
          Effect.tap((value) => publishAiChatEvent(context.user.id, value.id)),
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      );
    }),

    delete: os.sessions.delete.handler(({ input, context }) => {
      const program = AiChatService.use((service) =>
        service.deleteSession(context.user.id, input.sessionId)
      );

      return Effect.runPromise(
        program.pipe(
          Effect.tap(() =>
            publishAiChatEvent(context.user.id, input.sessionId)
          ),
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: () => null,
          })
        )
      );
    }),
    list: os.sessions.list.handler(({ context }) => {
      const program = AiChatService.use((service) =>
        service.listSessions(context.user.id)
      );

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      );
    }),
  },

  stream: {
    reconnect: os.stream.reconnect.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const activeStreamId = yield* AiChatService.use((service) =>
          service.getActiveStreamId(context.user.id, input.sessionId)
        );

        if (!activeStreamId) {
          // No active stream is a valid reconnect outcome, not an error.
          return emptyUiMessageChunkIterator();
        }

        const resumedSseStream = yield* Effect.tryPromise({
          catch: () =>
            new AiChatError({
              code: "INTERNAL",
              message: "Failed to resume chat stream.",
            }),
          try: () =>
            chatResumableStreamContext.resumeExistingStream(activeStreamId),
        }).pipe(
          // Reconnect is best-effort; treat resume failures as missing streams.
          Effect.catchTag("AiChatError", () => Effect.succeed(null))
        );

        if (!resumedSseStream) {
          // Don't clear activeStreamId on reconnect misses. During cross-device
          // handoff, reconnect can race stream registration/transient delivery.
          // The stream-end callback still clears the pointer when the stream
          // actually completes.
          return emptyUiMessageChunkIterator();
        }

        return streamToEventIterator(
          sseStringStreamToUiMessageChunkStream(resumedSseStream)
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      );
    }),
    send: os.stream.send.handler(({ input, context, signal }) => {
      const program = Effect.gen(function* () {
        const tools = createAiTools(context.user);
        const { originalMessages, streamResult, firstMessageText } =
          yield* AiChatService.use((service) =>
            service.startStream({
              abortSignal: signal,
              messages: input.messages,
              sessionId: input.sessionId,
              timeZone: input.timeZone,
              toolApproval: aiToolApproval,
              tools,
              userId: context.user.id,
            })
          );

        if (firstMessageText) {
          // Title generation is intentionally detached from stream startup.
          // Any failure here should never impact assistant response delivery.
          const titleGenerationProgram = AiChatService.use((service) =>
            service.generateSessionTitleFromFirstMessage({
              firstMessageText,
              sessionId: input.sessionId,
              userId: context.user.id,
            })
          ).pipe(
            Effect.tap((didUpdate) =>
              didUpdate
                ? publishAiChatEvent(context.user.id, input.sessionId)
                : Effect.void
            ),
            Effect.provide(AiChatLive),
            Effect.match({
              onFailure: () => undefined,
              onSuccess: () => undefined,
            })
          );

          yield* Effect.forkDetach(titleGenerationProgram);
        }

        const uiChunkStream = toUIMessageStream({
          generateMessageId: () => uuidv7(),
          onEnd: async ({ messages }) => {
            await Effect.runPromise(
              AiChatService.use((service) =>
                service.persistAssistantFromUiMessages({
                  messages,
                  sessionId: input.sessionId,
                  userId: context.user.id,
                })
              ).pipe(Effect.provide(AiChatLive))
            );

            await Effect.runPromise(
              publishAiChatEvent(context.user.id, input.sessionId)
            );
          },
          originalMessages,
          stream: streamResult.stream,
        });

        const sseStream = uiMessageChunkStreamToSseStringStream(uiChunkStream);
        const streamId = generateId();
        const resumableSseStream = yield* Effect.tryPromise({
          catch: () =>
            new AiChatError({
              code: "INTERNAL",
              message: "Failed to create resumable stream.",
            }),
          try: () =>
            chatResumableStreamContext.createNewResumableStream(
              streamId,
              () => sseStream
            ),
        });

        if (!resumableSseStream) {
          return yield* Effect.fail(
            new AiChatError({
              code: "INTERNAL",
              message: "Failed to create resumable stream.",
            })
          );
        }

        yield* AiChatService.use((service) =>
          service.markActiveStream({
            sessionId: input.sessionId,
            streamId,
            userId: context.user.id,
          })
        );
        yield* publishAiChatEvent(context.user.id, input.sessionId);

        return streamToEventIterator(
          sseStringStreamToUiMessageChunkStream(resumableSseStream)
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      );
    }),
  },
});
