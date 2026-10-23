import { implement, ORPCError } from "@orpc/server";
import { Match } from "effect";
import { mapErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { whoopContract } from "./contract";
import type { WhoopError } from "./errors";
import { WhoopService } from "./service";

function toORPCError(error: WhoopError) {
  return Match.valueTags(error, {
    WhoopApiError: (e) =>
      new ORPCError("SERVICE_UNAVAILABLE", {
        cause: e,
        data: { operation: e.operation, status: e.status },
        message: e.message,
      }),
    WhoopInvalidRangeError: (e) =>
      new ORPCError("BAD_REQUEST", {
        cause: e,
        message: e.message,
      }),
    WhoopParseError: (e) =>
      new ORPCError("PARSE_ERROR", {
        cause: e,
        data: { operation: e.operation },
        message: e.message,
      }),
    WhoopTokenUnavailableError: (e) =>
      new ORPCError("SERVICE_UNAVAILABLE", {
        cause: e,
        data: {
          accountId: e.accountId,
          whoopErrorCode: "TOKEN_UNAVAILABLE",
        },
        message: e.message,
      }),
  });
}

const handler = mapErrors(toORPCError);

const os = implement(whoopContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

export const whoopRouter = os.router({
  days: {
    list: os.days.list.effect(
      handler(function* ({ context, input }) {
        return yield* WhoopService.use((service) =>
          service.listDaySummaries({
            accountId: input.accountId,
            endDate: input.endDate,
            startDate: input.startDate,
            timeZone: input.timeZone,
            userId: context.user.id,
          })
        );
      })
    ),
  },
  profile: {
    get: os.profile.get.effect(
      handler(function* ({ context, input }) {
        return yield* WhoopService.use((service) =>
          service.getProfile({
            accountId: input.accountId,
            userId: context.user.id,
          })
        );
      })
    ),
  },
});
