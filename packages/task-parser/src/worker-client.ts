/**
 * The parser behind a Worker (worker.ts), with the same `parse` as
 * createTaskParser. Parsing a long input with the pretrained encoder takes
 * ~20 ms, which would otherwise land on the typing thread.
 */
import { Temporal } from "temporal-polyfill";
import type { ParsedTask, TagOption, TaskParser } from "./parser";
import {
  fromWire,
  type WorkerRequest,
  type WorkerResponse,
} from "./worker-wire";

/** Omit applied to each member of a union, keeping the union. */
type DistributiveOmit<T, Key extends PropertyKey> = T extends unknown
  ? Omit<T, Key>
  : never;

interface Pending {
  reject: (error: Error) => void;
  resolve: (response: WorkerResponse) => void;
}

/** Loads the weights at `url` inside `worker`; resolves once it can parse. */
export async function createWorkerTaskParser(
  worker: Worker,
  url: string
): Promise<TaskParser & { terminate: () => void }> {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const waiting = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (event.data.type === "error") {
      waiting?.reject(new Error(event.data.message));
    } else {
      waiting?.resolve(event.data);
    }
  });
  worker.addEventListener("error", (event) => {
    for (const waiting of pending.values()) {
      waiting.reject(new Error(event.message || "Task parser worker failed"));
    }
    pending.clear();
  });
  function send(request: DistributiveOmit<WorkerRequest, "id">) {
    nextId += 1;
    const id = nextId;
    return new Promise<WorkerResponse>((resolve, reject) => {
      pending.set(id, { reject, resolve });
      worker.postMessage({ ...request, id });
    });
  }

  await send({ type: "load", url });
  return {
    async parse<Id extends string>(
      text: string,
      {
        now = Temporal.Now.zonedDateTimeISO(),
        tags = [],
      }: { now?: Temporal.ZonedDateTime; tags?: TagOption<Id>[] } = {}
    ) {
      const response = await send({
        now: now.toString(),
        tags,
        text,
        type: "parse",
      });
      if (response.type !== "parsed") {
        throw new Error("Unexpected task parser worker reply");
      }
      return fromWire(response.result) as ParsedTask<Id>;
    },
    terminate: () => worker.terminate(),
  };
}
