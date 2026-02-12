import { Schema } from "effect";

export const aiChatErrorCodeSchema = Schema.Literal(
  "UNAUTHORIZED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "MODEL_NOT_CONFIGURED",
  "INTERNAL"
);
export type AiChatErrorCode = Schema.Schema.Type<typeof aiChatErrorCodeSchema>;

/**
 * Schema-backed domain error for AI chat flows.
 * Uses TaggedError for consistent Effect-TS error modeling and serialization.
 */
export class AiChatError extends Schema.TaggedError<AiChatError>()(
  "AiChatError",
  {
    code: aiChatErrorCodeSchema,
    message: Schema.String,
  }
) {}

export function isAiChatError(error: unknown): error is AiChatError {
  return error instanceof AiChatError;
}
