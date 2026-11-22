import { expect, mock, test } from "bun:test";

mock.module("@kompose/env", () => ({
  env: { GOOGLE_WEBHOOK_TOKEN: "channel-token" },
}));
// The work isn't run here, so the service it would use is never touched.
mock.module("./webhook-service", () => ({ WebhookService: {} }));
const { receiveWebhook } = await import("./receive");

function googleCall(token: string) {
  return new Request("https://kompose.test/api/webhooks/google-calendar", {
    headers: {
      "x-goog-channel-id": "channel",
      "x-goog-channel-token": token,
      "x-goog-resource-id": "resource",
    },
    method: "POST",
  });
}

// "constructor" is not a plugin ID; "whoop" is one with no handler.
test.each(["constructor", "whoop"])(
  "the source %p has no handler and gets a 404",
  async (source) => {
    const result = await receiveWebhook(
      source,
      new Request(`https://kompose.test/api/webhooks/${source}`)
    );

    expect(result.response.status).toBe(404);
    expect(result.work).toBeUndefined();
  }
);

test("a call the handler rejects does no work", async () => {
  const result = await receiveWebhook(
    "google-calendar",
    googleCall("wrong-token")
  );

  expect(result.response.status).toBe(400);
  expect(result.work).toBeUndefined();
});

test("a call the handler accepts is answered with work to run after", async () => {
  const result = await receiveWebhook(
    "google-calendar",
    googleCall("channel-token")
  );

  expect(result.response.status).toBe(200);
  expect(result.work).toBeDefined();
});
