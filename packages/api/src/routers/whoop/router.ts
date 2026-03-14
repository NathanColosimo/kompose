import { implement, ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { TelemetryLive } from "../../telemetry";
import { WhoopCacheService } from "./cache";
import { whoopContract } from "./contract";
import type { WhoopError } from "./errors";
import { WhoopService } from "./service";

const WhoopLive = Layer.mergeAll(
  WhoopService.Default,
  WhoopCacheService.Default,
  TelemetryLive
);

function handleError(error: WhoopError): never {
  switch (error._tag) {
    case "WhoopAccountNotLinkedError":
      throw new ORPCError("ACCOUNT_NOT_LINKED", {
        message: error.message,
        data: {
          accountId: error.accountId,
        },
      });
    case "WhoopInvalidRangeError":
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
      });
    case "WhoopParseError":
      throw new ORPCError("PARSE_ERROR", {
        message: error.message,
        data: {
          cause: error.cause,
          operation: error.operation,
        },
      });
    case "WhoopApiError":
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: error.message,
        data: {
          cause: error.cause,
          operation: error.operation,
          status: error.status,
        },
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "An unexpected WHOOP error occurred",
      });
  }
}

const os = implement(whoopContract).use(requireAuth).use(globalRateLimit);

export const whoopRouter = os.router({
  days: {
    list: os.days.list.handler(({ context, input }) =>
      Effect.runPromise(
        WhoopService.listDaySummaries({
          accountId: input.accountId,
          endDate: input.endDate,
          startDate: input.startDate,
          timeZone: input.timeZone,
          userId: context.user.id,
        }).pipe(
          Effect.provide(WhoopLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      )
    ),
  },
  profile: {
    get: os.profile.get.handler(({ context, input }) =>
      Effect.runPromise(
        WhoopService.getProfile({
          accountId: input.accountId,
          userId: context.user.id,
        }).pipe(
          Effect.provide(WhoopLive),
          Effect.match({
            onSuccess: (value) => value,
            onFailure: handleError,
          })
        )
      )
    ),
  },
});
