import { AiChatError, AiChatService } from "@kompose/ai";
import { implement, ORPCError, streamToEventIterator } from "@orpc/server";
import { generateId, type UIMessageChunk } from "ai";
import { Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { TelemetryLive } from "../../telemetry";
import { aiContract } from "./contract";
import { chatResumableStreamContext } from "./resumable-stream";
import {
  sseStringStreamToUiMessageChunkStream,
  uiMessageChunkStreamToSseStringStream,
} from "./stream-protocol";

const AiChatLive = Layer.merge(AiChatService.Default, TelemetryLive);

function emptyUiMessageChunkIterator() {
  return streamToEventIterator(
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.close();
      },
    })
  );
}

function handleError(error: AiChatError): never {
  switch (error.code) {
    case "UNAUTHORIZED":
      throw new ORPCError("UNAUTHORIZED", { message: error.message });
    case "NOT_FOUND":
      throw new ORPCError("NOT_FOUND", { message: error.message });
    case "BAD_REQUEST":
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    case "MODEL_NOT_CONFIGURED":
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
  }
}

const os = implement(aiContract).use(requireAuth).use(globalRateLimit);

export const aiRouter = os.router({
  sessions: {
    list: os.sessions.list.handler(({ context }) => {
      const program = AiChatService.listSessions(context.user.id);

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),

    create: os.sessions.create.handler(({ input, context }) => {
      const program = AiChatService.createSession(context.user.id, input);

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),

    delete: os.sessions.delete.handler(({ input, context }) => {
      const program = AiChatService.deleteSession(
        context.user.id,
        input.sessionId
      );

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),
  },

  messages: {
    list: os.messages.list.handler(({ input, context }) => {
      const program = AiChatService.listMessages(
        context.user.id,
        input.sessionId
      );

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),
  },

  stream: {
    send: os.stream.send.handler(({ input, context, signal }) => {
      const program = Effect.gen(function* () {
        const { originalMessages, streamResult } =
          yield* AiChatService.startStream({
            userId: context.user.id,
            sessionId: input.sessionId,
            message: input.message,
            abortSignal: signal,
          });

        const uiChunkStream = streamResult.toUIMessageStream({
          originalMessages,
          generateMessageId: () => uuidv7(),
          onFinish: async ({ messages }) => {
            await Effect.runPromise(
              AiChatService.persistAssistantFromUiMessages({
                userId: context.user.id,
                sessionId: input.sessionId,
                messages,
              }).pipe(Effect.provide(AiChatLive))
            );
          },
        });

        const sseStream = uiMessageChunkStreamToSseStringStream(uiChunkStream);
        const streamId = generateId();
        const resumableSseStream = yield* Effect.tryPromise({
          try: () =>
            chatResumableStreamContext.createNewResumableStream(
              streamId,
              () => sseStream
            ),
          catch: () =>
            new AiChatError({
              message: "Failed to create resumable stream.",
              code: "INTERNAL",
            }),
        });

        if (!resumableSseStream) {
          return yield* Effect.fail(
            new AiChatError({
              message: "Failed to create resumable stream.",
              code: "INTERNAL",
            })
          );
        }

        yield* AiChatService.markActiveStream({
          userId: context.user.id,
          sessionId: input.sessionId,
          streamId,
        });

        return streamToEventIterator(
          sseStringStreamToUiMessageChunkStream(resumableSseStream)
        );
      });

      return Effect.runPromise(
        program.pipe(
          Effect.provide(AiChatLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),

    reconnect: os.stream.reconnect.handler(({ input, context }) => {
      const program = Effect.gen(function* () {
        const activeStreamId = yield* AiChatService.getActiveStreamId(
          context.user.id,
          input.sessionId
        );

        if (!activeStreamId) {
          // No active stream is a valid reconnect outcome, not an error.
          return emptyUiMessageChunkIterator();
        }

        const resumedSseStream = yield* Effect.tryPromise({
          try: () =>
            chatResumableStreamContext.resumeExistingStream(activeStreamId),
          catch: () =>
            new AiChatError({
              message: "Failed to resume chat stream.",
              code: "INTERNAL",
            }),
        }).pipe(
          // Reconnect is best-effort; treat resume failures as missing streams.
          Effect.catchTag("AiChatError", () => Effect.succeed(null))
        );

        if (!resumedSseStream) {
          yield* AiChatService.markActiveStream({
            userId: context.user.id,
            sessionId: input.sessionId,
            streamId: null,
          });

          // Stale stream pointer: clear it and return an empty iterator.
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
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      );
    }),
  },
});
