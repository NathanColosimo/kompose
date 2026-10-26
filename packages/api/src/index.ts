import "@orpc/effect/extensions/effect";
import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";
import { toORPCError } from "./errors";

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
 * Sends each failure a procedure's contract declares as that typed error.
 * Everything else passes through, and oRPC sends it as a generic 500.
 */
export const encodeErrors = os.middleware(async ({ next, procedure }) => {
  try {
    return await next();
  } catch (error) {
    throw toORPCError(procedure["~orpc"].errorMap, error);
  }
});
