import { db } from "@kompose/db";
import { account as accountTable } from "@kompose/db/schema/auth";
import { implement, ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { getAccountInfo } from "./account-info";
import { accountContract } from "./contract";

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
      const accounts = await db
        .select({
          id: accountTable.id,
          providerId: accountTable.providerId,
        })
        .from(accountTable)
        .where(eq(accountTable.userId, context.user.id));

      return await Promise.all(
        accounts.map(async (account) => {
          const { email, name } = await getAccountInfo({
            account,
            userId: context.user.id,
          });
          return {
            id: account.id,
            providerId: account.providerId,
            email,
            name,
          };
        })
      );
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
