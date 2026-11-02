/// <reference lib="webworker" />
/**
 * Runs the parser off the main thread, serving workerContract. Load this
 * module as a module Worker and connect with `connectTaskParser`
 * (worker-client.ts).
 */
import { implement, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { createTaskParser, type TaskParser } from "./parser";
import { serializer, workerContract } from "./worker-contract";

const CACHE_NAME = "task-parser";

/**
 * The weight file at `url`, kept in the Cache API so later sessions (and
 * the desktop app) skip the download. Weight URLs are content-hashed, so a
 * cached copy never goes stale; older models' copies are deleted.
 */
async function fetchWeights(url: string) {
  const cache =
    typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  const cached = await cache?.match(url);
  if (cached) {
    return cached.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Task parser weights: HTTP ${response.status}`);
  }
  if (cache) {
    const key = new Request(url).url;
    // Not awaited: a failed write (storage full) just means no cache.
    cache
      .put(key, response.clone())
      .then(() => cache.keys())
      .then((requests) =>
        Promise.all(
          requests.flatMap((request) =>
            request.url === key ? [] : [cache.delete(request)]
          )
        )
      )
      .catch(() => undefined);
  }
  return response.arrayBuffer();
}

const os = implement(workerContract);
let parse: TaskParser | null = null;

const router = os.router({
  load: os.load.handler(async ({ input }) => {
    parse = createTaskParser(await fetchWeights(input.url));
  }),
  parse: os.parse.handler(({ input: { text, now, tags } }) => {
    if (!parse) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "Task parser not loaded",
      });
    }
    return parse(text, { now, tags });
  }),
});

new RPCHandler(router, { serializer }).upgrade(self);
