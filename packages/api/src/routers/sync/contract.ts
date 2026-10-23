import { asyncIteratorObject, oc } from "@orpc/contract";
import z from "zod";
import { syncEventSchema } from "../../realtime/events";

export type SyncEvent = z.infer<typeof syncEventSchema>;

export const streamSyncEvents = oc
  .input(z.object({}).optional())
  .output(asyncIteratorObject(syncEventSchema));

export const syncContract = {
  events: streamSyncEvents,
};
