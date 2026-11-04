import { implement } from "@orpc/server";
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
    return yield* listLinkedAccountsWithProfile(context.user.id);
  }),
});
