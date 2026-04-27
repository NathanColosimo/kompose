import { Database } from "@kompose/db";
import {
  type TagInsertRow,
  type TagUpdate,
  tagTable,
} from "@kompose/db/schema/tag";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

export const dbSelectTags = Effect.fn("TagDB.selectTags")(function* (
  userId: string
) {
  const db = yield* Database;
  return yield* db
    .select()
    .from(tagTable)
    .where(eq(tagTable.userId, userId))
    .orderBy(asc(tagTable.name));
});

export const dbSelectTagByName = Effect.fn("TagDB.selectTagByName")(function* (
  userId: string,
  name: string
) {
  const db = yield* Database;
  return yield* db
    .select()
    .from(tagTable)
    .where(and(eq(tagTable.userId, userId), eq(tagTable.name, name)));
});

export const dbSelectTagById = Effect.fn("TagDB.selectTagById")(function* (
  userId: string,
  tagId: string
) {
  const db = yield* Database;
  return yield* db
    .select()
    .from(tagTable)
    .where(and(eq(tagTable.userId, userId), eq(tagTable.id, tagId)));
});

export const dbSelectTagIdsByIds = Effect.fn("TagDB.selectTagIdsByIds")(
  function* (userId: string, tagIds: string[]) {
    const db = yield* Database;
    return yield* db
      .select({ id: tagTable.id })
      .from(tagTable)
      .where(and(eq(tagTable.userId, userId), inArray(tagTable.id, tagIds)));
  }
);

export const dbInsertTag = Effect.fn("TagDB.insertTag")(function* (
  values: TagInsertRow[]
) {
  const db = yield* Database;
  return yield* db.insert(tagTable).values(values).returning();
});

export const dbUpdateTag = Effect.fn("TagDB.updateTag")(function* (
  userId: string,
  tagId: string,
  values: TagUpdate
) {
  const db = yield* Database;
  return yield* db
    .update(tagTable)
    .set(values)
    .where(and(eq(tagTable.id, tagId), eq(tagTable.userId, userId)))
    .returning();
});

export const dbDeleteTag = Effect.fn("TagDB.deleteTag")(function* (
  userId: string,
  tagId: string
) {
  const db = yield* Database;
  return yield* db
    .delete(tagTable)
    .where(and(eq(tagTable.id, tagId), eq(tagTable.userId, userId)))
    .returning({ id: tagTable.id });
});
