import { DatabaseLive } from "@kompose/db";
import type {
  TagInsert,
  TagInsertRow,
  TagUpdate,
} from "@kompose/db/schema/tag";
import { Context, Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
import {
  dbDeleteTag,
  dbInsertTag,
  dbSelectTagById,
  dbSelectTagByName,
  dbSelectTags,
  dbUpdateTag,
} from "./db";
import { InvalidTagError, TagConflictError, TagNotFoundError } from "./errors";

// ============================================================================
// Service Definition (Effect.Service + Effect.fn pattern)
// ============================================================================

export class TagService extends Context.Service<TagService>()("TagService", {
  make: Effect.gen(function* () {
    const listTags = Effect.fn("TagService.listTags")(function* (
      userId: string
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      return yield* dbSelectTags(userId);
    });

    const createTag = Effect.fn("TagService.createTag")(function* (
      userId: string,
      input: TagInsert
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      const name = input.name.trim();
      if (!name) {
        return yield* Effect.fail(
          new InvalidTagError({ message: "Tag name is required" })
        );
      }

      const existing = yield* dbSelectTagByName(userId, name);
      if (existing.length > 0) {
        return yield* Effect.fail(new TagConflictError({ name }));
      }

      const insertRow: TagInsertRow = {
        icon: input.icon,
        id: uuidv7(),
        name,
        userId,
      };

      const [created] = yield* dbInsertTag([insertRow]);

      if (!created) {
        return yield* Effect.fail(
          new InvalidTagError({ message: "Failed to create tag" })
        );
      }

      return created;
    });

    const updateTag = Effect.fn("TagService.updateTag")(function* (
      userId: string,
      tagId: string,
      input: TagUpdate
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      yield* Effect.annotateCurrentSpan("tagId", tagId);
      if (input.name === undefined && input.icon === undefined) {
        return yield* Effect.fail(
          new InvalidTagError({ message: "No tag updates provided" })
        );
      }

      const [existing] = yield* dbSelectTagById(userId, tagId);
      if (!existing) {
        return yield* Effect.fail(new TagNotFoundError({ tagId }));
      }

      let nextName = existing.name;
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed) {
          return yield* Effect.fail(
            new InvalidTagError({ message: "Tag name is required" })
          );
        }

        if (trimmed !== existing.name) {
          const conflicting = yield* dbSelectTagByName(userId, trimmed);
          const hasConflict = conflicting.some((tag) => tag.id !== tagId);
          if (hasConflict) {
            return yield* Effect.fail(new TagConflictError({ name: trimmed }));
          }
        }

        nextName = trimmed;
      }

      const nextIcon = input.icon ?? existing.icon;

      const [updated] = yield* dbUpdateTag(userId, tagId, {
        icon: nextIcon,
        name: nextName,
        updatedAt: new Date().toISOString(),
      });

      if (!updated) {
        return yield* Effect.fail(new TagNotFoundError({ tagId }));
      }

      return updated;
    });

    const deleteTag = Effect.fn("TagService.deleteTag")(function* (
      userId: string,
      tagId: string
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      yield* Effect.annotateCurrentSpan("tagId", tagId);
      const deleted = yield* dbDeleteTag(userId, tagId);
      if (deleted.length === 0) {
        return yield* Effect.fail(new TagNotFoundError({ tagId }));
      }
    });

    return { createTag, deleteTag, listTags, updateTag };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DatabaseLive)
  );
}
