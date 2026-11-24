import { appRuntime } from "@kompose/api/runtime";
import { receiveWebhook } from "@kompose/api/webhooks/receive";
import { after } from "next/server";

/**
 * Calls from outside services, such as Google Calendar push notifications.
 * Replies once the source's handler has checked the call, then runs the
 * handler's work in `after()`. See documents/plugins.md.
 */
async function receive(
  request: Request,
  { params }: { params: Promise<{ source: string }> }
): Promise<Response> {
  const { source } = await params;
  const { response, work } = await receiveWebhook(source, request);
  if (work) {
    after(() => appRuntime.runPromise(work));
  }
  return response;
}

// Some services verify a new webhook URL with a GET.
export const GET = receive;
export const POST = receive;
