import { implement, ORPCError } from "@orpc/server";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { accountContract } from "./contract";
import { listLinkedAccountsWithProfile } from "./list-linked-accounts";

const os = implement(accountContract).use(requireAuth).use(globalRateLimit);

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
  list: os.list.handler(async ({ context }) => {
    try {
      return await listLinkedAccountsWithProfile(context.user.id);
    } catch (cause) {
      if (cause instanceof ORPCError) {
        throw cause;
      }
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to list linked accounts",
        data: {
          operation: "account.list",
          userId: context.user.id,
          causeMessage: getCauseMessage(cause),
        },
      });
    }
  }),
});
