import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import {
  type InvalidTagError,
  type TagConflictError,
  type TagNotFoundError,
  Tags,
  TagsLive,
} from "./client";
import type { TagSelect } from "./contract";
import { tagContract, tagSelectSchemaWithIcon } from "./contract";
import type { TagRepositoryError } from "./errors";

type TagError =
  | TagRepositoryError
  | TagConflictError
  | TagNotFoundError
  | InvalidTagError;

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
    const program = Effect.gen(function* () {
      const service = yield* Tags;
      const tags = yield* service.listTags(context.user.id);
      const parsedTags: TagSelect[] = tagSelectSchemaWithIcon
        .array()
        .parse(tags);
      return parsedTags;
    }).pipe(Effect.provide(TagsLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),
  create: os.create.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tags;
      const tag = yield* service.createTag(context.user.id, {
        ...input,
        userId: context.user.id,
      });
      const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
      return parsedTag;
    }).pipe(Effect.provide(TagsLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),
  update: os.update.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tags;
      const tag = yield* service.updateTag(context.user.id, input.id, {
        name: input.name,
        icon: input.icon,
      });
      const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
      return parsedTag;
    }).pipe(Effect.provide(TagsLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),
  delete: os.delete.handler(({ input, context }) => {
    const program = Effect.gen(function* () {
      const service = yield* Tags;
      return yield* service.deleteTag(context.user.id, input.id);
    }).pipe(Effect.provide(TagsLive));

    return Effect.runPromise(
      Effect.match(program, {
        onSuccess: (res) => res,
        onFailure: (err) => handleError(err),
      })
    );
  }),
});
