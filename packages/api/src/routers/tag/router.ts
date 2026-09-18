import { DatabaseLive } from "@kompose/db";
import { implement, ORPCError } from "@orpc/server";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { TelemetryLive } from "../../telemetry";
import { TagService } from "./client";
import type { TagSelect } from "./contract";
import { tagContract, tagSelectSchemaWithIcon } from "./contract";
import type { TagError } from "./errors";

const TagLive = Layer.mergeAll(TagService.layer, DatabaseLive, TelemetryLive);

function handleError(error: TagError | EffectDrizzleQueryError): never {
  if (error._tag === "EffectDrizzleQueryError") {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      data: {
        cause: error.cause,
        query: error.query,
      },
      message: error.message,
    });
  }

  switch (error._tag) {
    case "TagRepositoryError":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        data: { cause: error.cause },
        message: error.message ?? "Tag operation failed",
      });
    case "TagConflictError":
      throw new ORPCError("CONFLICT", {
        message: `Tag name already exists: ${error.name}`,
      });
    case "TagNotFoundError":
      throw new ORPCError("NOT_FOUND", {
        message: `Tag not found: ${error.tagId}`,
      });
    case "InvalidTagError":
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "An unexpected error occurred",
      });
  }
}

const os = implement(tagContract).use(requireAuth).use(globalRateLimit);

export const tagRouter = os.router({
  create: os.create.handler(({ input, context }) =>
    Effect.runPromise(
      TagService.use((service) =>
        service.createTag(context.user.id, {
          ...input,
          userId: context.user.id,
        })
      ).pipe(
        Effect.map((tag) => {
          const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
          return parsedTag;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onFailure: handleError,
          onSuccess: (value) => value,
        })
      )
    )
  ),

  delete: os.delete.handler(({ input, context }) =>
    Effect.runPromise(
      TagService.use((service) =>
        service.deleteTag(context.user.id, input.id)
      ).pipe(
        Effect.provide(TagLive),
        Effect.match({
          onFailure: handleError,
          onSuccess: () => null,
        })
      )
    )
  ),
  list: os.list.handler(({ context }) =>
    Effect.runPromise(
      TagService.use((service) => service.listTags(context.user.id)).pipe(
        Effect.map((tags) => {
          const parsedTags: TagSelect[] = tagSelectSchemaWithIcon
            .array()
            .parse(tags);
          return parsedTags;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onFailure: handleError,
          onSuccess: (value) => value,
        })
      )
    )
  ),

  update: os.update.handler(({ input, context }) =>
    Effect.runPromise(
      TagService.use((service) =>
        service.updateTag(context.user.id, input.id, {
          icon: input.icon,
          name: input.name,
        })
      ).pipe(
        Effect.map((tag) => {
          const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
          return parsedTag;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onFailure: handleError,
          onSuccess: (value) => value,
        })
      )
    )
  ),
});
