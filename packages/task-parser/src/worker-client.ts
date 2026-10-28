/**
 * The parser behind a Worker (worker.ts), with the same `parse` as
 * createTaskParser but async, so a parse never lands on the typing thread.
 */
import { wrap } from "comlink";
import { Temporal } from "temporal-polyfill";
import type { ParsedTask, ParseOptions } from "./parser";
import type { WorkerApi } from "./worker";

/** The shipped weights; the bundler gives the file a content-hashed URL. */
const WEIGHTS_URL = new URL("../task-parser.bin", import.meta.url).href;

/** Loads the weights at `url` inside `worker`; resolves once it can parse. */
export async function createWorkerTaskParser(
  worker: Worker,
  url = WEIGHTS_URL
) {
  const remote = wrap<WorkerApi>(worker);
  await remote.load(url);
  return async function parse<Id extends string>(
    text: string,
    { now = Temporal.Now.zonedDateTimeISO(), tags = [] }: ParseOptions<Id> = {}
  ): Promise<ParsedTask<Id>> {
    const task = await remote.parse(text, now.toString(), tags);
    return {
      ...task,
      dueDate: task.dueDate ? Temporal.PlainDate.from(task.dueDate) : null,
      startDate: task.startDate
        ? Temporal.PlainDate.from(task.startDate)
        : null,
      startTime: task.startTime
        ? Temporal.PlainTime.from(task.startTime)
        : null,
      tags: task.tags as ParsedTask<Id>["tags"],
    };
  };
}

export type RemoteTaskParser = Awaited<
  ReturnType<typeof createWorkerTaskParser>
>;
