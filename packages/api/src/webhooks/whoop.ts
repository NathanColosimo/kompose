import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@kompose/env";
import { z } from "zod";
import { WhoopService } from "../routers/whoop/service";

/** WHOOP also sends a `trace_id`, for spotting a repeated call. */
const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  user_id: z.number(),
});

/**
 * WHOOP signs each call with the app's client secret:
 * base64(HMAC-SHA256(timestamp header + raw body)).
 */
function isSignedByWhoop(request: Request, body: Buffer) {
  const secret = env.WHOOP_CLIENT_SECRET;
  const timestamp = request.headers.get("x-whoop-signature-timestamp");
  const signature = request.headers.get("x-whoop-signature");
  if (!(secret && timestamp && signature)) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(body)
    .digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseNotification(body: string) {
  try {
    return notificationSchema.safeParse(JSON.parse(body)).data;
  } catch {
    // Not JSON: the caller answers 400, like any other body it can't read.
  }
}

/**
 * WHOOP webhooks: a workout, sleep or recovery of a user was updated or
 * deleted. The work drops the cached days that record can be on and tells the
 * user's clients to refetch. WHOOP may skip or repeat a call; the cache's own
 * expiry covers a skipped one, and a repeat only clears the cache again.
 * See documents/whoop.md.
 */
export async function handleWhoopWebhook(request: Request) {
  // The signature covers the body's exact bytes, so check it before decoding.
  const body = Buffer.from(await request.arrayBuffer());
  if (!isSignedByWhoop(request, body)) {
    return {
      response: new Response("Invalid WHOOP signature", { status: 401 }),
    };
  }
  const notification = parseNotification(body.toString());
  if (!notification) {
    return {
      response: new Response("Invalid WHOOP notification", { status: 400 }),
    };
  }

  const change = {
    id: notification.id,
    type: notification.type,
    whoopUserId: String(notification.user_id),
  };
  return {
    response: new Response("OK"),
    work: WhoopService.use((whoop) => whoop.dataChanged(change)),
  };
}
