import { expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Effect } from "effect";

const SECRET = "whoop-client-secret";
const TIMESTAMP = "1767225600000";

mock.module("@kompose/env", () => ({
  env: { WHOOP_CLIENT_SECRET: SECRET },
}));
// The work isn't run here, so the services it would use are never touched.
mock.module("./webhook-service", () => ({ WebhookService: {} }));
mock.module("../routers/whoop/service", () => ({
  WhoopService: { use: () => Effect.void },
}));
const { receiveWebhook } = await import("./receive");

/** A call signed the way WHOOP signs: the timestamp, then the exact body. */
function whoopCall(body: string, { secret = SECRET, signedBody = body } = {}) {
  return new Request("https://kompose.test/api/webhooks/whoop", {
    body,
    headers: {
      "x-whoop-signature": createHmac("sha256", secret)
        .update(TIMESTAMP + signedBody)
        .digest("base64"),
      "x-whoop-signature-timestamp": TIMESTAMP,
    },
    method: "POST",
  });
}

const notification = (whoopUserId: number) =>
  JSON.stringify({
    id: "550e8400-e29b-41d4-a716-446655440000",
    trace_id: "e369c784-5100-49e8-8098-75d35c47b31b",
    type: "sleep.updated",
    user_id: whoopUserId,
  });

test.each([
  ["signed with another secret", whoopCall(notification(1), { secret: "x" })],
  [
    "whose body changed after signing",
    whoopCall(notification(2), { signedBody: notification(1) }),
  ],
  [
    "with no signature",
    new Request("https://kompose.test/api/webhooks/whoop", {
      body: notification(1),
      method: "POST",
    }),
  ],
])("a call %s is refused and does no work", async (_name, request) => {
  const result = await receiveWebhook("whoop", request);

  expect(result.response.status).toBe(401);
  expect(result.work).toBeUndefined();
});

test.each(["not json", JSON.stringify({ type: "sleep.updated", user_id: 1 })])(
  "a signed call that isn't a notification is refused: %s",
  async (body) => {
    const result = await receiveWebhook("whoop", whoopCall(body));

    expect(result.response.status).toBe(400);
    expect(result.work).toBeUndefined();
  }
);

test("a signed call is answered with work to run after", async () => {
  const result = await receiveWebhook("whoop", whoopCall(notification(1)));

  expect(result.response.status).toBe(200);
  expect(result.work).toBeDefined();
});
