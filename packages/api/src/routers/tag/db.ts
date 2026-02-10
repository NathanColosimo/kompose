import { db } from "@kompose/db";
import {
  type TagInsertRow,
  type TagUpdate,
  tagTable,
} from "@kompose/db/schema/tag";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TagRepositoryError } from "./errors";

export const dbSelectTags = Effect.fn("TagDB.selectTags")(function* (
  userId: string
) {
  return yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(tagTable)
        .where(eq(tagTable.userId, userId))
        .orderBy(asc(tagTable.name)),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});

export const dbSelectTagByName = Effect.fn("TagDB.selectTagByName")(function* (
  userId: string,
  name: string
) {
  return yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(tagTable)
        .where(and(eq(tagTable.userId, userId), eq(tagTable.name, name))),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});

export const dbSelectTagById = Effect.fn("TagDB.selectTagById")(function* (
  userId: string,
  tagId: string
) {
  return yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(tagTable)
        .where(and(eq(tagTable.userId, userId), eq(tagTable.id, tagId))),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});

export const dbSelectTagIdsByIds = Effect.fn("TagDB.selectTagIdsByIds")(
  function* (userId: string, tagIds: string[]) {
    return yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: tagTable.id })
          .from(tagTable)
          .where(
            and(eq(tagTable.userId, userId), inArray(tagTable.id, tagIds))
          ),
      catch: (cause) => new TagRepositoryError({ cause }),
    });
  }
);

export const dbInsertTag = Effect.fn("TagDB.insertTag")(function* (
  values: TagInsertRow[]
) {
  return yield* Effect.tryPromise({
    try: () => db.insert(tagTable).values(values).returning(),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});

export const dbUpdateTag = Effect.fn("TagDB.updateTag")(function* (
  userId: string,
  tagId: string,
  values: TagUpdate
) {
  return yield* Effect.tryPromise({
    try: () =>
      db
        .update(tagTable)
        .set(values)
        .where(and(eq(tagTable.id, tagId), eq(tagTable.userId, userId)))
        .returning(),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});

export const dbDeleteTag = Effect.fn("TagDB.deleteTag")(function* (
  userId: string,
  tagId: string
) {
  return yield* Effect.tryPromise({
    try: () =>
      db
        .delete(tagTable)
        .where(and(eq(tagTable.id, tagId), eq(tagTable.userId, userId)))
        .returning({ id: tagTable.id }),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
});
