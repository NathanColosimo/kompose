import { expect, mock, test } from "bun:test";

mock.module("@kompose/env", () => ({
  env: { GOOGLE_WEBHOOK_TOKEN: "channel-token" },
}));
// The work isn't run here, so the service it would use is never touched.
mock.module("../webhook-service", () => ({ WebhookService: {} }));
const { handleGoogleCalendarWebhook } = await import("./notification");

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

test("a call with the wrong channel token is refused and does no work", () => {
  const result = handleGoogleCalendarWebhook(googleCall("wrong-token"));

  expect(result.response.status).toBe(400);
  expect(result.work).toBeUndefined();
});

test("a call with the right channel token is answered with work to run after", () => {
  const result = handleGoogleCalendarWebhook(googleCall("channel-token"));

  expect(result.response.status).toBe(200);
  expect(result.work).toBeDefined();
});
