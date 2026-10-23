import { implement, ORPCError } from "@orpc/server";
import { effectErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { TagService } from "./client";
import type { TagSelect } from "./contract";
import { tagContract, tagSelectSchemaWithIcon } from "./contract";
import type { TagError } from "./errors";

const os = implement(tagContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit)
  .use(
    effectErrors<TagError>({
      InvalidTagError: (error) =>
        new ORPCError("BAD_REQUEST", { cause: error, message: error.message }),
      TagConflictError: (error) =>
        new ORPCError("CONFLICT", {
          cause: error,
          message: `Tag name already exists: ${error.name}`,
        }),
      TagNotFoundError: (error) =>
        new ORPCError("NOT_FOUND", {
          cause: error,
          message: `Tag not found: ${error.tagId}`,
        }),
      TagRepositoryError: (error) =>
        new ORPCError("INTERNAL_SERVER_ERROR", {
          cause: error,
          data: { cause: error.cause },
          message: error.message ?? "Tag operation failed",
        }),
    })
  );

export const tagRouter = os.router({
  create: os.create.effect(function* ({ input, context }) {
    const tag = yield* TagService.use((service) =>
      service.createTag(context.user.id, {
        ...input,
        userId: context.user.id,
      })
    );
    const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
    return parsedTag;
  }),

  delete: os.delete.effect(function* ({ input, context }) {
    yield* TagService.use((service) =>
      service.deleteTag(context.user.id, input.id)
    );
    return null;
  }),

  list: os.list.effect(function* ({ context }) {
    const tags = yield* TagService.use((service) =>
      service.listTags(context.user.id)
    );
    const parsedTags: TagSelect[] = tagSelectSchemaWithIcon.array().parse(tags);
    return parsedTags;
  }),

  update: os.update.effect(function* ({ input, context }) {
    const tag = yield* TagService.use((service) =>
      service.updateTag(context.user.id, input.id, {
        icon: input.icon,
        name: input.name,
      })
    );
    const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
    return parsedTag;
  }),
});
