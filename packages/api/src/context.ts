import { auth } from "@kompose/auth";
import type { WithEffectContext } from "@orpc/experimental-effect";
import { ORPCError } from "@orpc/server";
import type { User } from "better-auth";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { type AppServices, appRuntime } from "./runtime";

// used in RPCHandler in api route
export async function createContext(req: NextRequest): Promise<Context> {
  const [result, effectContext] = await Promise.all([
    auth.api.getSession({
      headers: req.headers,
    }),
    appRuntime.context(),
  ]);

  return {
    "effect/context": effectContext,
    "effect/wrap": mapSharedErrors,
    user: result?.user,
  };
}

export interface Context extends WithEffectContext<AppServices> {
  user?: User;
}

/**
 * Maps failures any router can hit. Routers map their own domain errors
 * with `effectErrors` before these run.
 */
function mapSharedErrors<A>(
  effect: Effect.Effect<A, unknown>
): Effect.Effect<A, unknown> {
  return effect.pipe(
    Effect.mapError((error) =>
      error instanceof EffectDrizzleQueryError
        ? new ORPCError("INTERNAL_SERVER_ERROR", {
            cause: error,
            data: { cause: error.cause, query: error.query },
            message: error.message,
          })
        : error
    )
  );
}
