import { db } from "@kompose/db";
import { type TaskUpdate, taskTable } from "@kompose/db/schema/task";
import { and, desc, eq, gte } from "drizzle-orm";
import { Effect } from "effect";
import { TaskRepositoryError } from "./client";

export const dbSelect = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(taskTable)
        .where(eq(taskTable.userId, userId))
        .orderBy(desc(taskTable.createdAt)),
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
