import "@orpc/experimental-effect/extensions/effect";
import type { EffectWrapOptions } from "@orpc/experimental-effect";
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

interface TaggedError {
  readonly _tag: string;
}

type TaggedErrorMappers<E extends TaggedError> = {
  readonly [K in E["_tag"]]: (
    error: Extract<E, { _tag: K }>,
    opts: EffectWrapOptions
  ) => ORPCError<string, unknown>;
};

function isTaggedError(error: unknown): error is TaggedError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
  );
}

/**
 * Maps a router's tagged Effect errors to `ORPCError`s for every effectful
 * handler below it. Wraps any outer `effect/wrap`, so shared mappings from
 * `createContext` still apply to whatever this one leaves untouched.
 */
export function effectErrors<E extends TaggedError>(
  mappers: TaggedErrorMappers<E>
) {
  const lookup = mappers as unknown as Record<
    string,
    (error: TaggedError, opts: EffectWrapOptions) => ORPCError<string, unknown>
  >;

  return base.middleware(({ context, next }) => {
    const outer = context["effect/wrap"];

    return next({
      context: {
        "effect/wrap": <A>(
          effect: Effect.Effect<A, unknown>,
          opts: EffectWrapOptions
        ) => {
          const mapped = effect.pipe(
            Effect.mapError((error) => {
              const map = isTaggedError(error) ? lookup[error._tag] : undefined;
              return map && isTaggedError(error) ? map(error, opts) : error;
            })
          );
          return outer ? outer(mapped, opts) : mapped;
        },
      },
    });
  });
}
