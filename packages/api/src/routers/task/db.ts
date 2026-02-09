import { db } from "@kompose/db";
import type { TagSelect } from "@kompose/db/schema/tag";
import { tagTable, taskTagTable } from "@kompose/db/schema/tag";
import { type TaskUpdate, taskTable } from "@kompose/db/schema/task";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TaskRepositoryError } from "./errors";

type TaskSelectRow = typeof taskTable.$inferSelect;
type TaskWithTagRelations = TaskSelectRow & {
  taskTags: Array<{ tag: TagSelect }>;
};

export type TaskWithTagsRow = TaskSelectRow & { tags: TagSelect[] };

const mapTaskWithTags = (task: TaskWithTagRelations): TaskWithTagsRow => {
  const { taskTags, ...rest } = task;
  return {
    ...rest,
    tags: taskTags.map((entry) => entry.tag),
  };
};

const mapTasksWithTags = (tasks: TaskWithTagRelations[]): TaskWithTagsRow[] =>
  tasks.map((task) => mapTaskWithTags(task));

export const dbSelect = (userId: string) =>
  Effect.tryPromise({
    try: async () => {
      const tasks = await db.query.taskTable.findMany({
        where: (task, { eq }) => eq(task.userId, userId),
        orderBy: (task, { desc }) => desc(task.createdAt),
        with: {
          taskTags: {
            with: {
              tag: true,
            },
          },
        },
      });
      return mapTasksWithTags(tasks);
    },
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbSelectById = (userId: string, taskId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(taskTable)
        .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId))),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbSelectBySeries = (userId: string, seriesMasterId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(taskTable)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId)
          )
        )
        .orderBy(asc(taskTable.startDate)),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbSelectBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(taskTable)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId),
            gte(taskTable.startDate, fromDate)
          )
        )
        .orderBy(asc(taskTable.startDate)),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbSelectByIdsWithTags = (userId: string, taskIds: string[]) =>
  Effect.tryPromise({
    try: async () => {
      if (taskIds.length === 0) {
        return [];
      }

      const tasks = await db.query.taskTable.findMany({
        where: (task, { and, eq }) =>
          and(eq(task.userId, userId), inArray(task.id, taskIds)),
        with: {
          taskTags: {
            with: {
              tag: true,
            },
          },
        },
      });

      return mapTasksWithTags(tasks);
    },
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export type TaskInsertRow = typeof taskTable.$inferInsert;

export const dbInsert = (values: TaskInsertRow[]) =>
  Effect.tryPromise({
    try: () => db.insert(taskTable).values(values).returning(),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbUpdate = (
  userId: string,
  taskId: string,
  input: TaskUpdate & { isException?: boolean }
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(taskTable)
        .set(input)
        .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)))
        .returning(),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbUpdateBySeries = (
  userId: string,
  seriesMasterId: string,
  input: TaskUpdate
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(taskTable)
        .set(input)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId)
          )
        )
        .returning(),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbUpdateBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string,
  input: TaskUpdate
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(taskTable)
        .set(input)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId),
            gte(taskTable.startDate, fromDate)
          )
        )
        .returning(),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbDelete = (userId: string, taskId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(taskTable)
        .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId))),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbDeleteBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(taskTable)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId),
            gte(taskTable.startDate, fromDate)
          )
        ),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbDeleteNonExceptionsBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(taskTable)
        .where(
          and(
            eq(taskTable.seriesMasterId, seriesMasterId),
            eq(taskTable.userId, userId),
            gte(taskTable.startDate, fromDate),
            eq(taskTable.isException, false)
          )
        ),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbInsertTaskTags = (
  values: (typeof taskTagTable.$inferInsert)[]
) =>
  Effect.tryPromise({
    try: () => db.insert(taskTagTable).values(values).returning(),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbDeleteTaskTagsForTasks = (taskIds: string[]) =>
  Effect.tryPromise({
    try: () =>
      db.delete(taskTagTable).where(inArray(taskTagTable.taskId, taskIds)),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });

export const dbSelectTagIdsForUser = (userId: string, tagIds: string[]) =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ id: tagTable.id })
        .from(tagTable)
        .where(and(eq(tagTable.userId, userId), inArray(tagTable.id, tagIds))),
    catch: (cause) => new TaskRepositoryError({ cause }),
  });
