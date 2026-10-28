/// <reference lib="webworker" />
/**
 * Runs the parser off the main thread. Load this module as a module Worker
 * and wrap it with `createWorkerTaskParser` (worker-client.ts).
 */
import { expose } from "comlink";
import { Temporal } from "temporal-polyfill";
import {
  createTaskParser,
  type ParsedTask,
  type TagOption,
  type TaskParser,
} from "./parser";

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

/** Temporal values don't survive structured cloning: they cross as ISO strings. */
function toWire(task: ParsedTask) {
  return {
    ...task,
    dueDate: task.dueDate?.toString() ?? null,
    startDate: task.startDate?.toString() ?? null,
    startTime: task.startTime?.toString() ?? null,
  };
}

let parse: TaskParser | null = null;

const api = {
  async load(url: string) {
    parse = createTaskParser(await fetchWeights(url));
  },
  parse(text: string, now: string, tags: TagOption[]) {
    if (!parse) {
      throw new Error("Task parser not loaded");
    }
    return toWire(parse(text, { now: Temporal.ZonedDateTime.from(now), tags }));
  },
};

export type WorkerApi = typeof api;

expose(api);
