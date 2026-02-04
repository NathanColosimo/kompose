import type {
  TagInsert,
  TagInsertRow,
  TagSelect,
} from "@kompose/db/schema/tag";
import { Context, Data, Effect, Layer } from "effect";
import { uuidv7 } from "uuidv7";
import {
  dbDeleteTag,
  dbInsertTag,
  dbSelectTagByName,
  dbSelectTags,
} from "./db";
import type { TagRepositoryError } from "./errors";

export class TagConflictError extends Data.TaggedError("TagConflictError")<{
  name: string;
}> {}

export class TagNotFoundError extends Data.TaggedError("TagNotFoundError")<{
  tagId: string;
}> {}

export class InvalidTagError extends Data.TaggedError("InvalidTagError")<{
  message: string;
}> {}

type TagError =
  | TagRepositoryError
  | TagConflictError
  | TagNotFoundError
  | InvalidTagError;

export interface TagService {
  readonly listTags: (userId: string) => Effect.Effect<TagSelect[], TagError>;
  readonly createTag: (
    userId: string,
    input: TagInsert
  ) => Effect.Effect<TagSelect, TagError>;
  readonly deleteTag: (
    userId: string,
    tagId: string
  ) => Effect.Effect<void, TagError>;
}

export class Tags extends Context.Tag("Tags")<Tags, TagService>() {}

const listTags = (userId: string): Effect.Effect<TagSelect[], TagError> =>
  dbSelectTags(userId);

const createTag = (
  userId: string,
  input: TagInsert
): Effect.Effect<TagSelect, TagError> =>
  Effect.gen(function* () {
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
      id: uuidv7(),
      userId,
      name,
      icon: input.icon,
    };

    const [created] = yield* dbInsertTag([insertRow]);

    if (!created) {
      return yield* Effect.fail(
        new InvalidTagError({ message: "Failed to create tag" })
      );
    }

    return created;
  });

const deleteTag = (
  userId: string,
  tagId: string
): Effect.Effect<void, TagError> =>
  Effect.gen(function* () {
    const deleted = yield* dbDeleteTag(userId, tagId);
    if (deleted.length === 0) {
      return yield* Effect.fail(new TagNotFoundError({ tagId }));
    }
  });

const tagService: TagService = {
  listTags,
  createTag,
  deleteTag,
};

export const TagsLive = Layer.succeed(Tags, tagService);
