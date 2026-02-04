import { db } from "@kompose/db";
import { type TagInsertRow, tagTable } from "@kompose/db/schema/tag";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TagRepositoryError } from "./errors";

export const dbSelectTags = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(tagTable)
        .where(eq(tagTable.userId, userId))
        .orderBy(asc(tagTable.name)),
    catch: (cause) => new TagRepositoryError({ cause }),
  });

export const dbSelectTagByName = (userId: string, name: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(tagTable)
        .where(and(eq(tagTable.userId, userId), eq(tagTable.name, name))),
    catch: (cause) => new TagRepositoryError({ cause }),
  });

export const dbSelectTagIdsByIds = (userId: string, tagIds: string[]) =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ id: tagTable.id })
        .from(tagTable)
        .where(and(eq(tagTable.userId, userId), inArray(tagTable.id, tagIds))),
    catch: (cause) => new TagRepositoryError({ cause }),
  });

export const dbInsertTag = (values: TagInsertRow[]) =>
  Effect.tryPromise({
    try: () => db.insert(tagTable).values(values).returning(),
    catch: (cause) => new TagRepositoryError({ cause }),
  });

export const dbDeleteTag = (userId: string, tagId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(tagTable)
        .where(and(eq(tagTable.id, tagId), eq(tagTable.userId, userId)))
        .returning({ id: tagTable.id }),
    catch: (cause) => new TagRepositoryError({ cause }),
  });
