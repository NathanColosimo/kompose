import { appRuntime } from "@kompose/api/runtime";
import { handleGoogleCalendarWebhook } from "@kompose/api/webhooks/google-cal/notification";
import { after } from "next/server";

/**
 * Google Calendar push notifications. Replies as soon as the headers check
 * out, then syncs in `after()`. See documents/services.md.
 */
export function POST(request: Request): Response {
  const { response, sync } = handleGoogleCalendarWebhook(request);
  if (sync) {
    after(() => appRuntime.runPromise(sync));
  }
  return response;
}
