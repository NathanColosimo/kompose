import { openai } from "@ai-sdk/openai";
import { env } from "@kompose/env";
import { AiChatError } from "./errors";

export const DEFAULT_CHAT_MODEL = "gpt-5-mini";

/**
 * Resolve a language model for chat streaming. We validate environment state
 * explicitly so callers get a clear runtime error when not configured.
 */
export function resolveChatModel(model?: string): ReturnType<typeof openai> {
  if (!env.OPENAI_API_KEY) {
    throw new AiChatError({
      message: "OPENAI_API_KEY is required for AI chat routes.",
      code: "MODEL_NOT_CONFIGURED",
    });
  }

  return openai(model ?? DEFAULT_CHAT_MODEL);
}
