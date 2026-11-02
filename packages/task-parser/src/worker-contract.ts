/**
 * The parser Worker's procedures (worker.ts implements them, worker-client.ts
 * calls them), and the serializer both sides use so Temporal values cross
 * as themselves.
 */
import { type RPCJsonSerializerHandler, RPCSerializer } from "@orpc/client";
import { oc, type } from "@orpc/contract";
import { Temporal } from "temporal-polyfill";
import type { ParsedTask, TagOption } from "./parser";

export const workerContract = {
  /** Loads the weight file at `url`; call once, before parse. */
  load: oc.input(type<{ url: string }>()),
  parse: oc
    .input(
      type<{ text: string; now: Temporal.ZonedDateTime; tags: TagOption[] }>()
    )
    .output(type<ParsedTask>()),
};

/** A Temporal type, sent as its ISO string. */
function temporal<T>(Type: {
  from: (text: string) => T;
  new (...args: never[]): T;
}): RPCJsonSerializerHandler {
  return {
    condition: (value) => value instanceof Type,
    deserialize: (serialized) => Type.from(serialized as string),
    isTerminal: true,
    serialize: (value: T) => String(value),
  };
}

export const serializer = new RPCSerializer({
  handlers: {
    plainDate: temporal(Temporal.PlainDate),
    plainTime: temporal(Temporal.PlainTime),
    zonedDateTime: temporal(Temporal.ZonedDateTime),
  },
});
