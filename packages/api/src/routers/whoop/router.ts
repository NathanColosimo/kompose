import { implement } from "@orpc/server";
import { requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { whoopContract } from "./contract";
import { WhoopService } from "./service";

const os = implement(whoopContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

export const whoopRouter = os.router({
  days: {
    list: os.days.list.effect(function* ({ context, input }) {
      return yield* WhoopService.use((service) =>
        service.listDaySummaries({
          accountId: input.accountId,
          endDate: input.endDate,
          startDate: input.startDate,
          timeZone: input.timeZone,
          userId: context.user.id,
        })
      );
    }),
  },
  profile: {
    get: os.profile.get.effect(function* ({ context, input }) {
      return yield* WhoopService.use((service) =>
        service.getProfile({
          accountId: input.accountId,
          userId: context.user.id,
        })
      );
    }),
  },
});
