import { appRuntime } from "@kompose/api/runtime";
import { handleGoogleCalendarWebhook } from "@kompose/api/webhooks/google-cal/notification";
import { after } from "next/server";

/**
 * Google Calendar push notifications. Replies once the call is checked, then
 * runs the work in `after()`: Google sends a call again when the reply is slow.
 */
export function POST(request: Request): Response {
  const { response, work } = handleGoogleCalendarWebhook(request);
  if (work) {
    after(() => appRuntime.runPromise(work));
  }
  return response;
}
