import type { WebhookSubscriptionProvider } from "@kompose/db/schema/webhook-subscription";
import { Schema } from "effect";

/**
 * Extracts a human-readable message from an unknown error cause.
 */
export function formatUnknownCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message?.trim() || cause.name || "Unknown error";
  }
  if (typeof cause === "string") {
    return cause || "Unknown error";
  }
  if (
    cause != null &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof (cause as { message: unknown }).message === "string"
  ) {
    return (cause as { message: string }).message.trim() || "Unknown error";
  }
  return cause == null ? "Unknown error" : String(cause);
}

export class WebhookRepositoryError extends Schema.TaggedError<WebhookRepositoryError>()(
  "WebhookRepositoryError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class WebhookProviderError extends Schema.TaggedError<WebhookProviderError>()(
  "WebhookProviderError",
  {
    operation: Schema.String,
    provider: Schema.String,
    message: Schema.String,
  }
) {
  declare readonly provider: WebhookSubscriptionProvider;
}

export class WebhookAuthError extends Schema.TaggedError<WebhookAuthError>()(
  "WebhookAuthError",
  {
    accountId: Schema.String,
    message: Schema.String,
  }
) {}

export class WebhookValidationError extends Schema.TaggedError<WebhookValidationError>()(
  "WebhookValidationError",
  {
    message: Schema.String,
  }
) {}

export type WebhookError =
  | WebhookAuthError
  | WebhookProviderError
  | WebhookRepositoryError
  | WebhookValidationError;
