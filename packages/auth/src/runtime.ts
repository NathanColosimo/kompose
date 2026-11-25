import { DatabaseLive, runtimeMemoMap } from "@kompose/db";
import { ManagedRuntime } from "effect";

/**
 * Runs the Effect code that Better Auth's hooks call. Better Auth serves its
 * own routes, outside the API's `appRuntime`, and `@kompose/api` imports this
 * package, so that runtime can't be used here. The memo map shares the API
 * runtime's Postgres pool.
 */
export const authRuntime = ManagedRuntime.make(DatabaseLive, {
  memoMap: runtimeMemoMap,
});
