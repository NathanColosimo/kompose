/**
 * Runs the parser off the main thread. Load this module as a module Worker
 * and talk to it through `createWorkerTaskParser` (worker-client.ts).
 */
import { Temporal } from "temporal-polyfill";
import { createTaskParser, type TaskParser } from "./parser";
import { toWire, type WorkerRequest, type WorkerResponse } from "./worker-wire";

let parser: Promise<TaskParser> | null = null;

async function load(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Task parser weights: HTTP ${response.status}`);
  }
  return createTaskParser(await response.arrayBuffer());
}

function reply(message: WorkerResponse) {
  postMessage(message);
}

addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      parser = load(request.url);
      await parser;
      reply({ id: request.id, type: "ready" });
      return;
    }
    if (!parser) {
      throw new Error("Task parser not loaded");
    }
    const result = await (await parser).parse(request.text, {
      now: Temporal.ZonedDateTime.from(request.now),
      tags: request.tags,
    });
    reply({ id: request.id, result: toWire(result), type: "parsed" });
  } catch (error) {
    reply({
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
});
