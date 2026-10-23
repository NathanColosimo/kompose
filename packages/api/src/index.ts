import "@orpc/experimental-effect/extensions/effect";
import { ORPCError, os } from "@orpc/server";
import { Effect } from "effect";
import type { Context } from "./context";

export const base = os.$context<Context>();

export const requireAuth = base.middleware(({ context, next }) => {
  if (!context.user?.id) {
    throw new ORPCError("UNAUTHORIZED", { message: "User not found" });
  }

  return next({
    context: {
      user: context.user,
    },
  });
});

/**
 * Runs every Effect failure from a router's handlers through `toORPCError`.
 * Return an `ORPCError` for errors the router knows about and the error
 * itself for the rest; oRPC sends those as a generic 500.
 */
export function mapErrors(toORPCError: (error: unknown) => unknown) {
  return base.middleware(({ next }) =>
    next({
      context: {
        "effect/wrap": <A>(effect: Effect.Effect<A, unknown>) =>
          effect.pipe(Effect.mapError(toORPCError)),
      },
    })
  );
}
