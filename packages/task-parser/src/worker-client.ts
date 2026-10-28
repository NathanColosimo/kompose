/**
 * The parser behind a Worker (worker.ts): a typed oRPC client for
 * workerContract, so a parse never lands on the typing thread.
 */
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { ContractRouterClient } from "@orpc/contract";
import { serializer, type workerContract } from "./worker-contract";

/** The shipped weights; the bundler gives the file a content-hashed URL. */
const WEIGHTS_URL = new URL("../task-parser.bin", import.meta.url).href;

export type TaskParserClient = ContractRouterClient<typeof workerContract>;

/** A client for the parser in `worker`, once it has loaded the weights at `url`. */
export async function connectTaskParser(
  worker: Worker,
  url = WEIGHTS_URL
): Promise<TaskParserClient> {
  const client: TaskParserClient = createORPCClient(
    new RPCLink({ port: worker, serializer })
  );
  await client.load({ url });
  return client;
}
