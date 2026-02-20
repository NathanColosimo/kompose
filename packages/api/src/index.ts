import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";

export const base = os.$context<Context>();

export const requireAuth = base.middleware(({ context, next }) => {
  if (!context.user?.id) {
    throw new ORPCError("UNAUTHORIZED User not found");
  }

  return next({
    context: {
      user: context.user,
    },
  });
});
