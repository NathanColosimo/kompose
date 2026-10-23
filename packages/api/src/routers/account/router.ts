import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { accountContract } from "./contract";
import { listLinkedAccountsWithProfile } from "./list-linked-accounts";

const os = implement(accountContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

function getCauseMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

export const accountRouter = os.router({
  list: os.list.effect(function* ({ context }) {
    return yield* listLinkedAccountsWithProfile(context.user.id).pipe(
      Effect.mapError(
        (cause) =>
          new ORPCError("INTERNAL_SERVER_ERROR", {
            cause,
            data: {
              causeMessage: getCauseMessage(cause),
              operation: "account.list",
              userId: context.user.id,
            },
            message: "Failed to list linked accounts",
          })
      )
    );
  }),
});
