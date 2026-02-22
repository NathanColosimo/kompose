import type { CreateAiSessionInput } from "@kompose/db/schema/ai";
import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type ToolSet,
  TypeValidationError,
  type UIMessage,
  type UIMessageChunk,
  validateUIMessages,
} from "ai";
import { Effect } from "effect";
import { AiChatError } from "./errors";
import { resolveChatModel } from "./model";
import { BASE_CHAT_SYSTEM_PROMPT, buildChatSystemPrompt } from "./prompt";
import { AiChatRepository } from "./repository";

function extractTextParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => {
      return part.type === "text" && typeof part.text === "string";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getPersistedContent(
  parts: UIMessage["parts"],
  fallback: string
): string {
  const text = extractTextParts(parts);
  return text.length > 0 ? text : fallback;
}

const MAX_SESSION_TITLE_LENGTH = 80;
const SESSION_TITLE_MODEL = "gpt-5-nano";

function normalizeGeneratedSessionTitle(text: string): string | null {
  // Providers occasionally return quoted or multi-line content. Normalize to
  // a compact single-line title for stable sidebar rendering.
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) {
    return null;
  }

  const withoutOuterQuotes = singleLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (withoutOuterQuotes.length === 0) {
    return null;
  }

  return withoutOuterQuotes.slice(0, MAX_SESSION_TITLE_LENGTH);
}

interface UiStreamResultLike {
  toUIMessageStream: (options?: {
    originalMessages?: UIMessage[];
    generateMessageId?: () => string;
    onFinish?: (input: { messages: UIMessage[] }) => void | Promise<void>;
  }) => ReadableStream<UIMessageChunk>;
  toUIMessageStreamResponse: (options: {
    originalMessages: UIMessage[];
    generateMessageId?: () => string;
    onFinish?: (input: { messages: UIMessage[] }) => void | Promise<void>;
    consumeSseStream?: (input: {
      stream: ReadableStream<string>;
    }) => void | Promise<void>;
  }) => Response;
}

/**
 * Chat service that centralizes persistence + model orchestration.
 * Route handlers should remain thin wrappers around this service.
 */
export class AiChatService extends Effect.Service<AiChatService>()(
  "AiChatService",
  {
    accessors: true,
    dependencies: [AiChatRepository.Default],
    effect: Effect.gen(function* () {
      const repository = yield* AiChatRepository;

      const listSessions = Effect.fn("AiChatService.listSessions")(function* (
        userId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        return yield* repository.listSessions(userId);
      });

      const createSession = Effect.fn("AiChatService.createSession")(function* (
        userId: string,
        input: CreateAiSessionInput
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        return yield* repository.createSession(userId, input);
      });

      const deleteSession = Effect.fn("AiChatService.deleteSession")(function* (
        userId: string,
        sessionId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        yield* repository.deleteSession(userId, sessionId);
      });

      const listMessages = Effect.fn("AiChatService.listMessages")(function* (
        userId: string,
        sessionId: string
      ) {
        yield* Effect.annotateCurrentSpan("userId", userId);
        yield* Effect.annotateCurrentSpan("sessionId", sessionId);
        yield* repository.getSession(userId, sessionId);
        return yield* repository.listMessages(sessionId);
      });

      const getActiveStreamId = Effect.fn("AiChatService.getActiveStreamId")(
        function* (userId: string, sessionId: string) {
          yield* Effect.annotateCurrentSpan("userId", userId);
          yield* Effect.annotateCurrentSpan("sessionId", sessionId);
          const session = yield* repository.getSession(userId, sessionId);
          return session.activeStreamId;
        }
      );

      const markActiveStream = Effect.fn("AiChatService.markActiveStream")(
        function* (input: {
          userId: string;
          sessionId: string;
          streamId: string | null;
        }) {
          yield* repository.updateSessionActivity({
            userId: input.userId,
            sessionId: input.sessionId,
            activeStreamId: input.streamId,
          });
        }
      );

      const persistAssistantFromUiMessages = Effect.fn(
        "AiChatService.persistAssistantFromUiMessages"
      )(function* (input: {
        userId: string;
        sessionId: string;
        messages: UIMessage[];
      }) {
        const lastAssistantMessage = [...input.messages]
          .reverse()
          .find((message) => message.role === "assistant");

        if (lastAssistantMessage && lastAssistantMessage.parts.length > 0) {
          const content = getPersistedContent(
            lastAssistantMessage.parts,
            "[non-text assistant message]"
          );

          // During tool-approval round-trips, onFinish fires once when the
          // stream pauses for approval and again after the tool executes. If
          // the most recent persisted message is already an assistant message
          // (from the earlier round), update it in place instead of creating a
          // duplicate row that would contain the same provider item IDs.
          const existingMessages = yield* repository.listMessages(
            input.sessionId
          );
          const lastPersistedMessage = existingMessages.at(-1);

          if (lastPersistedMessage?.role === "assistant") {
            yield* repository.updateMessageContent({
              messageId: lastPersistedMessage.id,
              content,
              parts: lastAssistantMessage.parts,
            });
          } else {
            yield* repository.createMessage({
              sessionId: input.sessionId,
              role: "assistant",
              content,
              parts: lastAssistantMessage.parts,
            });
          }
        }

        // Always clear active stream metadata when a stream finishes/aborts.
        yield* repository.updateSessionActivity({
          userId: input.userId,
          sessionId: input.sessionId,
          activeStreamId: null,
        });
      });

      const generateSessionTitleFromFirstMessage = Effect.fn(
        "AiChatService.generateSessionTitleFromFirstMessage"
      )(function* (input: {
        userId: string;
        sessionId: string;
        firstMessageText: string;
      }) {
        yield* Effect.annotateCurrentSpan("userId", input.userId);
        yield* Effect.annotateCurrentSpan("sessionId", input.sessionId);

        const firstMessageText = input.firstMessageText.trim();
        if (firstMessageText.length === 0) {
          return false;
        }

        // Re-check persisted session state to avoid overwriting a manual title
        // or racing with another title-generation attempt.
        const session = yield* repository.getSession(
          input.userId,
          input.sessionId
        );
        if ((session.title ?? "").trim().length > 0) {
          return false;
        }

        const titleResult = yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: resolveChatModel(SESSION_TITLE_MODEL),
              system: [
                "Generate a concise chat title from the first user message.",
                "Requirements:",
                "- Return title text only.",
                "- Keep it under 8 words.",
                "- Do not use quotes, prefixes, or trailing punctuation.",
              ].join("\n"),
              prompt: `First user message: ${firstMessageText}`,
            }),
          catch: () =>
            new AiChatError({
              message: "Failed to generate chat session title.",
              code: "INTERNAL",
            }),
        });

        const title = normalizeGeneratedSessionTitle(titleResult.text);
        if (!title) {
          return false;
        }

        yield* repository.updateSessionActivity({
          userId: input.userId,
          sessionId: input.sessionId,
          title,
        });

        return true;
      });

      const startStream: (input: {
        userId: string;
        sessionId: string;
        messages: UIMessage[];
        timeZone?: string;
        tools?: ToolSet;
        abortSignal?: AbortSignal;
      }) => Effect.Effect<
        {
          originalMessages: UIMessage[];
          streamResult: UiStreamResultLike;
          firstMessageText: string | null;
        },
        AiChatError
      > = Effect.fn("AiChatService.startStream")(function* (input: {
        userId: string;
        sessionId: string;
        messages: UIMessage[];
        timeZone?: string;
        tools?: ToolSet;
        abortSignal?: AbortSignal;
      }) {
        yield* Effect.annotateCurrentSpan("userId", input.userId);
        yield* Effect.annotateCurrentSpan("sessionId", input.sessionId);

        const session = yield* repository.getSession(
          input.userId,
          input.sessionId
        );
        const latestMessage = input.messages.at(-1);
        if (!latestMessage) {
          return yield* Effect.fail(
            new AiChatError({
              message: "Message content is required.",
              code: "BAD_REQUEST",
            })
          );
        }

        const hasSessionTitle = (session.title ?? "").trim().length > 0;
        let shouldGenerateTitle = false;
        let firstMessageText: string | null = null;
        let systemPromptText = BASE_CHAT_SYSTEM_PROMPT;

        // Always load persisted messages so we can read the system prompt for
        // every round (including approval round-trips where the latest message
        // is an assistant message, not a user message).
        const existingMessages = yield* repository.listMessages(
          input.sessionId
        );
        const isFirstMessageForSession = existingMessages.length === 0;
        const persistedSystemMessage = existingMessages.find(
          (message) => message.role === "system"
        );

        if (
          persistedSystemMessage &&
          persistedSystemMessage.content.trim().length > 0
        ) {
          systemPromptText = persistedSystemMessage.content;
        }

        // Persist the most recent user message for queryable session history.
        if (latestMessage.role === "user") {
          if (latestMessage.parts.length === 0) {
            return yield* Effect.fail(
              new AiChatError({
                message: "Message content is required.",
                code: "BAD_REQUEST",
              })
            );
          }

          if (isFirstMessageForSession && !persistedSystemMessage) {
            // Persist the first system prompt so later turns reuse the exact
            // same prompt text for stable provider-side prompt caching.
            systemPromptText = buildChatSystemPrompt({
              timeZone: input.timeZone,
            });
            yield* repository.createMessage({
              sessionId: input.sessionId,
              role: "system",
              content: systemPromptText,
              parts: [{ type: "text", text: systemPromptText }],
            });
          }

          const userText = extractTextParts(latestMessage.parts);
          shouldGenerateTitle =
            !hasSessionTitle &&
            isFirstMessageForSession &&
            userText.trim().length > 0;
          firstMessageText = shouldGenerateTitle ? userText : null;

          yield* repository.createMessage({
            sessionId: input.sessionId,
            role: "user",
            // Keep a textual summary for quick list/search while full structured
            // message payload lives in `parts`.
            content: getPersistedContent(
              latestMessage.parts,
              "[non-text user message]"
            ),
            parts: latestMessage.parts,
          });
        }

        const validatedMessages = yield* Effect.tryPromise({
          try: () => validateUIMessages({ messages: input.messages }),
          catch: (error) => {
            if (error instanceof TypeValidationError) {
              return new AiChatError({
                message: "Stored chat messages failed validation.",
                code: "BAD_REQUEST",
              });
            }
            return new AiChatError({
              message: "Failed to validate chat messages.",
              code: "INTERNAL",
            });
          },
        });

        const model = resolveChatModel(session.model ?? undefined);
        yield* Effect.annotateCurrentSpan("model", session.model ?? "default");
        const messagesWithSystem: UIMessage[] = [
          {
            id: `${input.sessionId}:system`,
            role: "system",
            parts: [{ type: "text", text: systemPromptText }],
          },
          ...validatedMessages.filter((message) => message.role !== "system"),
        ];
        const modelMessages = yield* Effect.tryPromise({
          try: () => convertToModelMessages(messagesWithSystem),
          catch: () =>
            new AiChatError({
              message: "Failed to convert chat messages for model.",
              code: "INTERNAL",
            }),
        });

        // streamText performs the provider network call. We keep this inside
        // an Effect.fn span so latency is visible in tracing.
        const streamResult = streamText({
          model,
          messages: modelMessages,
          stopWhen: stepCountIs(20),
          tools: input.tools,
          abortSignal: input.abortSignal,
          providerOptions: {
            // Request readable reasoning summaries when supported.
            openai: { reasoningSummary: "auto" },
          },
        });

        return {
          originalMessages: validatedMessages,
          streamResult: streamResult as UiStreamResultLike,
          firstMessageText: shouldGenerateTitle ? firstMessageText : null,
        };
      });

      return {
        listSessions,
        createSession,
        deleteSession,
        listMessages,
        getActiveStreamId,
        markActiveStream,
        persistAssistantFromUiMessages,
        generateSessionTitleFromFirstMessage,
        startStream,
      };
    }),
  }
) {}
