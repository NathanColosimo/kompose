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
 * Wraps an `.effect(...)` handler so its failures go through `toORPCError`.
 * The handler may only fail with errors `toORPCError` accepts, so a new
 * service error is a compile error until the router maps it.
 */
export function mapErrors<E>(
  toORPCError: (error: E) => ORPCError<string, unknown>
) {
  return <Opts, Y extends Effect.Effect<unknown, E, unknown>, A>(
    handler: (opts: Opts) => Generator<Y, A, never>
  ) =>
    function* (opts: Opts) {
      const program = Effect.gen(() => handler(opts)) as Effect.Effect<
        A,
        E,
        Effect.Services<Y>
      >;
      return yield* program.pipe(Effect.mapError(toORPCError));
    };
}
