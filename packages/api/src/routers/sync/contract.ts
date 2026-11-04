import { asyncIteratorObject, oc } from "@orpc/contract";
import z from "zod";
import { syncEventSchema } from "../../realtime/events";

export type { SyncEvent } from "../../realtime/events";

export const streamSyncEvents = oc
  .input(z.object({}).optional())
  .output(asyncIteratorObject(syncEventSchema));

export const syncContract = {
  events: streamSyncEvents,
};
