import type { WebhookSubscriptionSelect } from "@kompose/db/schema/webhook-subscription";
import { z } from "zod";

export const WATCH_RENEWAL_BUFFER_MS = 12 * 60 * 60 * 1000;
export const UNSUPPORTED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export function watchDecision(params: {
  existing?: Pick<WebhookSubscriptionSelect, "active" | "expiresAt">;
  now: number;
  unsupportedUntil?: string;
}): "keep" | "retry-later" | "replace" {
  if (
    params.unsupportedUntil &&
    Date.parse(params.unsupportedUntil) > params.now
  ) {
    return "retry-later";
  }
  if (
    params.existing?.active &&
    params.existing.expiresAt !== null &&
    Date.parse(params.existing.expiresAt) > params.now + WATCH_RENEWAL_BUFFER_MS
  ) {
    return "keep";
  }
  return "replace";
}

const googleWatchErrorSchema = z.object({
  cause: z.object({
    error: z.object({
      error: z.object({ errors: z.array(z.object({ reason: z.string() })) }),
    }),
  }),
});

/** GoogleApiError wraps the SDK error, which keeps Google's structured response. */
export function isUnsupportedWatchError(error: unknown): boolean {
  const parsed = googleWatchErrorSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.cause.error.error.errors.some(
      (detail) => detail.reason === "pushNotSupportedForRequestedResource"
    )
  );
}
