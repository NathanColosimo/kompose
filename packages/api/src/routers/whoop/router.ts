import { implement, ORPCError } from "@orpc/server";
import { effectErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { whoopContract } from "./contract";
import type { WhoopError } from "./errors";
import { WhoopService } from "./service";

const os = implement(whoopContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit)
  .use(
    effectErrors<WhoopError>({
      WhoopApiError: (error) =>
        new ORPCError("SERVICE_UNAVAILABLE", {
          cause: error,
          data: {
            cause: error.cause,
            operation: error.operation,
            status: error.status,
          },
          message: error.message,
        }),
      WhoopInvalidRangeError: (error) =>
        new ORPCError("BAD_REQUEST", { cause: error, message: error.message }),
      WhoopParseError: (error) =>
        new ORPCError("PARSE_ERROR", {
          cause: error,
          data: {
            cause: error.cause,
            operation: error.operation,
          },
          message: error.message,
        }),
      WhoopTokenUnavailableError: (error) =>
        new ORPCError("SERVICE_UNAVAILABLE", {
          cause: error,
          data: {
            accountId: error.accountId,
            whoopErrorCode: "TOKEN_UNAVAILABLE",
          },
          message: error.message,
        }),
    })
  );

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
