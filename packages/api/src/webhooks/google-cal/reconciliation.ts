import type { WebhookSubscriptionSelect } from "@kompose/db/schema/webhook-subscription";
import { Effect } from "effect";
import { z } from "zod";

export const WATCH_RENEWAL_BUFFER_MS = 12 * 60 * 60 * 1000;
export const UNSUPPORTED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export function isLiveSubscription(
  subscription: Pick<WebhookSubscriptionSelect, "active" | "expiresAt">,
  now: number
): boolean {
  return (
    subscription.active &&
    subscription.expiresAt !== null &&
    Date.parse(subscription.expiresAt) > now
  );
}

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
    params.existing &&
    isLiveSubscription(params.existing, params.now + WATCH_RENEWAL_BUFFER_MS)
  ) {
    return "keep";
  }
  return "replace";
}

/** Persist the new channel before retiring the old row. Stop it after commit. */
export function saveReplacement<A, E, R, E2, R2>(params: {
  create: Effect.Effect<A | undefined, E, R>;
  save: (channel: A) => Effect.Effect<void, E2, R2>;
}) {
  return Effect.gen(function* () {
    const channel = yield* params.create;
    if (!channel) {
      return false;
    }
    yield* params.save(channel);
    return true;
  });
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
