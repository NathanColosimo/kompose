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

export const accountRouter = os.router({
  list: os.list.effect(function* ({ context }) {
    return yield* listLinkedAccountsWithProfile(context.user.id).pipe(
      Effect.mapError(
        (cause) =>
          new ORPCError("INTERNAL_SERVER_ERROR", {
            cause,
            message: "Failed to list linked accounts",
          })
      )
    );
  }),
});
