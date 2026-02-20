import { auth } from "@kompose/auth";
import { implement, ORPCError } from "@orpc/server";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { accountContract } from "./contract";

const os = implement(accountContract).use(requireAuth).use(globalRateLimit);

export const accountRouter = os.router({
  list: os.list.handler(async ({ context }) => {
    try {
      const accounts = await auth.api.listUserAccounts({
        query: {
          userId: context.user.id,
        },
      });

      const accountsWithInfo = await Promise.all(
        accounts.map(async (account) => {
          const accountInfo = await auth.api.accountInfo({
            query: { accountId: account.accountId },
          });
          return {
            id: account.accountId,
            providerId: account.providerId,
            email: accountInfo?.user?.email ?? "",
            name: accountInfo?.user?.name ?? "",
          };
        })
      );

      return accountsWithInfo;
    } catch (cause) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to list linked accounts",
        data: { cause },
      });
    }
  }),
});
