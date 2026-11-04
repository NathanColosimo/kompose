/// <reference lib="webworker" />
/**
 * Serves workerContract off the main thread; `worker.ts` is the entry for a
 * dedicated Worker or a SharedWorker. Connect with `connectTaskParser`
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
// One model per worker, however many windows connect and ask it to load.
let loaded: { parser: Promise<TaskParser>; url: string } | null = null;

const router = os.router({
  load: os.load.handler(async ({ input }) => {
    if (loaded?.url !== input.url) {
      const parser = fetchWeights(input.url).then(createTaskParser);
      loaded = { parser, url: input.url };
      // A failed load is retried by the next `load`.
      parser.catch(() => {
        if (loaded?.parser === parser) {
          loaded = null;
        }
      });
    }
    await loaded.parser;
  }),
  parse: os.parse.handler(async ({ input: { text, now, tags } }) => {
    if (!loaded) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "Task parser not loaded",
      });
    }
    const parse = await loaded.parser;
    return parse(text, { now, tags });
  }),
});

/**
 * Serves the parser on each port it upgrades: a dedicated worker's scope, or
 * a started MessagePort.
 */
export const taskParserHandler = new RPCHandler(router, { serializer });
