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
  WhoopService.layer,
  WhoopCacheService.layer,
  TelemetryLive
);

function handleError(error: WhoopError): never {
  switch (error._tag) {
    case "WhoopTokenUnavailableError":
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        data: {
          accountId: error.accountId,
          whoopErrorCode: "TOKEN_UNAVAILABLE",
        },
        message: error.message,
      });
    case "WhoopInvalidRangeError":
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
      });
    case "WhoopParseError":
      throw new ORPCError("PARSE_ERROR", {
        data: {
          cause: error.cause,
          operation: error.operation,
        },
        message: error.message,
      });
    case "WhoopApiError":
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        data: {
          cause: error.cause,
          operation: error.operation,
          status: error.status,
        },
        message: error.message,
      });
    default: {
      const unknownError: never = error;
      throw unknownError;
    }
  }
}

const os = implement(whoopContract).use(requireAuth).use(globalRateLimit);

export const whoopRouter = os.router({
  days: {
    list: os.days.list.handler(({ context, input }) =>
      Effect.runPromise(
        WhoopService.use((service) =>
          service.listDaySummaries({
            accountId: input.accountId,
            endDate: input.endDate,
            startDate: input.startDate,
            timeZone: input.timeZone,
            userId: context.user.id,
          })
        ).pipe(
          Effect.provide(WhoopLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      )
    ),
  },
  profile: {
    get: os.profile.get.handler(({ context, input }) =>
      Effect.runPromise(
        WhoopService.use((service) =>
          service.getProfile({
            accountId: input.accountId,
            userId: context.user.id,
          })
        ).pipe(
          Effect.provide(WhoopLive),
          Effect.match({
            onFailure: handleError,
            onSuccess: (value) => value,
          })
        )
      )
    ),
  },
});
