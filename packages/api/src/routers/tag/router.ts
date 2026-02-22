import { implement, ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { TelemetryLive } from "../../telemetry";
import { TagService } from "./client";
import type { TagSelect } from "./contract";
import { tagContract, tagSelectSchemaWithIcon } from "./contract";
import type { TagError } from "./errors";

const TagLive = Layer.merge(TagService.Default, TelemetryLive);

function handleError(error: TagError): never {
  switch (error._tag) {
    case "TagRepositoryError":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error.message ?? "Tag operation failed",
        data: { cause: error.cause },
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
  list: os.list.handler(({ context }) => {
    return Effect.runPromise(
      TagService.listTags(context.user.id).pipe(
        Effect.map((tags) => {
          const parsedTags: TagSelect[] = tagSelectSchemaWithIcon
            .array()
            .parse(tags);
          return parsedTags;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onSuccess: (value) => value,
          onFailure: handleError,
        })
      )
    );
  }),

  create: os.create.handler(({ input, context }) => {
    return Effect.runPromise(
      TagService.createTag(context.user.id, {
        ...input,
        userId: context.user.id,
      }).pipe(
        Effect.map((tag) => {
          const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
          return parsedTag;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onSuccess: (value) => value,
          onFailure: handleError,
        })
      )
    );
  }),

  update: os.update.handler(({ input, context }) => {
    return Effect.runPromise(
      TagService.updateTag(context.user.id, input.id, {
        name: input.name,
        icon: input.icon,
      }).pipe(
        Effect.map((tag) => {
          const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
          return parsedTag;
        }),
        Effect.provide(TagLive),
        Effect.match({
          onSuccess: (value) => value,
          onFailure: handleError,
        })
      )
    );
  }),

  delete: os.delete.handler(({ input, context }) => {
    return Effect.runPromise(
      TagService.deleteTag(context.user.id, input.id).pipe(
        Effect.provide(TagLive),
        Effect.match({
          onSuccess: () => null,
          onFailure: handleError,
        })
      )
    );
  }),
});
