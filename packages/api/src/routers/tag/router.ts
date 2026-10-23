import { implement, ORPCError } from "@orpc/server";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Match } from "effect";
import { mapErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { TagService } from "./client";
import type { TagSelect } from "./contract";
import { tagContract, tagSelectSchemaWithIcon } from "./contract";
import type { TagError } from "./errors";

function toORPCError(error: TagError | EffectDrizzleQueryError) {
  return Match.valueTags(error, {
    EffectDrizzleQueryError: (e) =>
      new ORPCError("INTERNAL_SERVER_ERROR", { cause: e }),
    InvalidTagError: (e) =>
      new ORPCError("BAD_REQUEST", {
        cause: e,
        message: e.message,
      }),
    TagConflictError: (e) =>
      new ORPCError("CONFLICT", {
        cause: e,
        message: `Tag name already exists: ${e.name}`,
      }),
    TagNotFoundError: (e) =>
      new ORPCError("NOT_FOUND", {
        cause: e,
        message: `Tag not found: ${e.tagId}`,
      }),
  });
}

const handler = mapErrors(toORPCError);

const os = implement(tagContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

export const tagRouter = os.router({
  create: os.create.effect(
    handler(function* ({ input, context }) {
      const tag = yield* TagService.use((service) =>
        service.createTag(context.user.id, {
          ...input,
          userId: context.user.id,
        })
      );
      const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
      return parsedTag;
    })
  ),

  delete: os.delete.effect(
    handler(function* ({ input, context }) {
      yield* TagService.use((service) =>
        service.deleteTag(context.user.id, input.id)
      );
      return null;
    })
  ),

  list: os.list.effect(
    handler(function* ({ context }) {
      const tags = yield* TagService.use((service) =>
        service.listTags(context.user.id)
      );
      const parsedTags: TagSelect[] = tagSelectSchemaWithIcon
        .array()
        .parse(tags);
      return parsedTags;
    })
  ),

  update: os.update.effect(
    handler(function* ({ input, context }) {
      const tag = yield* TagService.use((service) =>
        service.updateTag(context.user.id, input.id, {
          icon: input.icon,
          name: input.name,
        })
      );
      const parsedTag: TagSelect = tagSelectSchemaWithIcon.parse(tag);
      return parsedTag;
    })
  ),
});
