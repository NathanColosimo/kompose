import { WhoopApiError, WhoopParseError } from "@kompose/whoop/errors";
import { implement, ORPCError } from "@orpc/server";
import { mapErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { whoopContract } from "./contract";
import { WhoopInvalidRangeError, WhoopTokenUnavailableError } from "./errors";
import { WhoopService } from "./service";

function toORPCError(error: unknown) {
  if (error instanceof WhoopApiError) {
    return new ORPCError("SERVICE_UNAVAILABLE", {
      cause: error,
      data: { operation: error.operation, status: error.status },
      message: error.message,
    });
  }
  if (error instanceof WhoopInvalidRangeError) {
    return new ORPCError("BAD_REQUEST", {
      cause: error,
      message: error.message,
    });
  }
  if (error instanceof WhoopParseError) {
    return new ORPCError("PARSE_ERROR", {
      cause: error,
      data: { operation: error.operation },
      message: error.message,
    });
  }
  if (error instanceof WhoopTokenUnavailableError) {
    return new ORPCError("SERVICE_UNAVAILABLE", {
      cause: error,
      data: { accountId: error.accountId, whoopErrorCode: "TOKEN_UNAVAILABLE" },
      message: error.message,
    });
  }
  return error;
}

const os = implement(whoopContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit)
  .use(mapErrors(toORPCError));

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
