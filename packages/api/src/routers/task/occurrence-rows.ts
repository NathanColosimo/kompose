import type {
  TaskInsert,
  TaskSelect,
  TaskUpdate,
  taskTable,
} from "@kompose/db/schema/task";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { generateOccurrences } from "../../lib/recurrence";

/**
 * Pure planning for a recurring series' rows: which occurrences an edit
 * keeps and creates, with what fields, and the pattern the part of a
 * series that outlives its master (or a split) carries. The task client
 * applies the plan to the database.
 */

export type TaskInsertRow = typeof taskTable.$inferInsert;

export type SystemManagedTaskField = "createdAt" | "updatedAt";
export type TaskInsertInput = Omit<TaskInsert, SystemManagedTaskField> & {
  createdAt?: never;
  tagIds?: string[];
  updatedAt?: never;
};
export type TaskUpdateInput = Omit<TaskUpdate, SystemManagedTaskField> & {
  createdAt?: never;
  tagIds?: string[];
  updatedAt?: never;
};

/**
 * A pattern a create or edit sets, with the date it counts from (checked:
 * it has one, and doesn't end before it).
 */
export interface CheckedPattern {
  recurrence: NonNullable<TaskSelect["recurrence"]>;
  startDate: string;
}

/** Parse a date string into Temporal.PlainDate (or null). */
export function parsePlainDate(
  value: string | null | undefined
): Temporal.PlainDate | null {
  return value ? Temporal.PlainDate.from(value) : null;
}

/** A due date for an occurrence, keeping the series' start-to-due offset. */
export function getDueDateForOccurrence(params: {
  baseStartDate: Temporal.PlainDate;
  baseDueDate: Temporal.PlainDate | null;
  occurrenceDate: Temporal.PlainDate;
}): string | null {
  // If the series has no due date, keep it unset for all occurrences.
  if (!params.baseDueDate) {
    return null;
  }

  // Preserve the original due-date offset from the series start date.
  const offset = params.baseStartDate.until(params.baseDueDate, {
    largestUnit: "days",
  });

  return params.occurrenceDate.add(offset).toString();
}

/**
 * Insert rows for occurrences of a series built from an edited task. Each
 * field takes the edit's value, else the task's, and due dates keep the
 * series' start-to-due offset. New occurrences start open: a done task
 * never makes its future copies done.
 */
export function buildOccurrenceRowsFromTask(params: {
  input: TaskUpdateInput;
  occurrenceDates: Temporal.PlainDate[];
  seriesMasterId: string;
  seriesStartDate: Temporal.PlainDate;
  task: TaskSelect;
  userId: string;
}): TaskInsertRow[] {
  const { input, task } = params;
  // A field the edit clears (null) stays cleared; only one it leaves out
  // (undefined) takes the task's value.
  const description =
    input.description === undefined ? task.description : input.description;
  const dueDate = input.dueDate === undefined ? task.dueDate : input.dueDate;
  const links = input.links === undefined ? task.links : input.links;
  const startTime =
    input.startTime === undefined ? task.startTime : input.startTime;
  const baseDueDate = parsePlainDate(dueDate);

  return params.occurrenceDates.map((date) => ({
    description,
    dueDate: getDueDateForOccurrence({
      baseDueDate,
      baseStartDate: params.seriesStartDate,
      occurrenceDate: date,
    }),
    durationMinutes: input.durationMinutes ?? task.durationMinutes,
    id: uuidv7(),
    isException: false,
    links,
    recurrence: null,
    seriesMasterId: params.seriesMasterId,
    startDate: date.toString(),
    startTime,
    status: "todo",
    title: input.title ?? task.title,
    userId: params.userId,
  }));
}

/**
 * An edit that moves a task but leaves its due date (omits it, or sends it
 * unchanged) moves the due date along, keeping the start-to-due offset, as
 * a "following" edit without a pattern change does for each occurrence.
 */
export function withMovedDueDate(
  task: TaskSelect,
  input: TaskUpdateInput
): TaskUpdateInput {
  const from = parsePlainDate(task.startDate);
  const to = parsePlainDate(input.startDate);
  const leavesDueDate =
    input.dueDate === undefined || input.dueDate === task.dueDate;
  if (!(from && to && leavesDueDate)) {
    return input;
  }
  return {
    ...input,
    dueDate: getDueDateForOccurrence({
      baseDueDate: parsePlainDate(task.dueDate),
      baseStartDate: from,
      occurrenceDate: to,
    }),
  };
}

/**
 * Whether a "this and following" pattern change keeps the edited occurrence
 * (it takes the edits, and becomes the new series' master with the pattern)
 * instead of replacing it: it is an exception already, the edit sets its
 * status (Mark done), or it starts on a date another kept task holds (Nov
 * 16 done alone, then Nov 9 moved onto it): the two are different tasks.
 */
export function keepsEditedOccurrence(params: {
  input: Pick<TaskUpdateInput, "status">;
  /** The dates other kept tasks (exceptions) hold from the split on. */
  keptDates: ReadonlySet<string>;
  /** Where the edited occurrence starts after the edit. */
  start: string;
  task: Pick<TaskSelect, "isException">;
}): boolean {
  return (
    params.task.isException ||
    params.input.status !== undefined ||
    params.keptDates.has(params.start)
  );
}

/**
 * The new occurrences for a "this and following" pattern change, from where
 * the edited occurrence now starts: its new date when the edit moves it
 * (Nov 9 moved to Nov 12, Daily x3: Nov 12, 13, 14), else its original
 * one. Dates other kept tasks hold are left out. When the edited
 * occurrence is kept, it holds the first date, as the master
 * (`seriesMasterId` is its id) carrying the pattern. Otherwise
 * the first row, on its date, replaces it: the new master, with the
 * pattern and its status. Other new occurrences start open.
 */
export function regeneratedOccurrenceRows(params: {
  input: TaskUpdateInput;
  keepEdited: boolean;
  /** The dates other kept tasks (exceptions) hold from the split on. */
  keptDates: ReadonlySet<string>;
  /** The new pattern, from the edited occurrence's start after the edit. */
  pattern: CheckedPattern;
  /** The new master's id: the edited occurrence's when it's kept. */
  seriesMasterId: string;
  task: TaskSelect;
  userId: string;
}): TaskInsertRow[] {
  const { input, pattern, task } = params;
  const seriesStartDate = Temporal.PlainDate.from(pattern.startDate);
  const skipped = new Set(params.keptDates);
  if (params.keepEdited) {
    skipped.add(pattern.startDate);
  }
  const occurrenceDates = generateOccurrences(
    pattern.recurrence,
    seriesStartDate
  ).filter((date) => !skipped.has(date.toString()));
  return buildOccurrenceRowsFromTask({
    input,
    occurrenceDates,
    seriesMasterId: params.seriesMasterId,
    // Due dates keep the edited task's own start-to-due offset, from its
    // start (Nov 10 due Nov 11 → Nov 17 due Nov 18).
    seriesStartDate,
    task,
    userId: params.userId,
  }).map((row, index) =>
    !params.keepEdited && index === 0
      ? {
          ...row,
          id: params.seriesMasterId,
          recurrence: pattern.recurrence,
          status: task.status,
        }
      : row
  );
}

/**
 * The pattern a series' next occurrence takes when its master is deleted
 * alone: the same rule, with a count of the occurrences actually left (an
 * earlier one may have been deleted, or moved), so "after N times" still
 * matches the rows.
 */
export function heirPattern(
  pattern: TaskSelect["recurrence"],
  remaining: number
): TaskSelect["recurrence"] {
  return pattern?.count ? { ...pattern, count: remaining } : pattern;
}

/** A pattern stopped before `boundary` (a count no longer applies). */
export function endedBefore(
  recurrence: NonNullable<TaskSelect["recurrence"]>,
  boundary: string,
  /** The last occurrence left before the boundary, if known. */
  lastDate?: string | null
): NonNullable<TaskSelect["recurrence"]> {
  const { count: _count, ...pattern } = recurrence;
  // The earliest of: the day before the boundary, the pattern's own end,
  // and its last remaining occurrence, so it never claims days it lacks.
  const ends = [
    Temporal.PlainDate.from(boundary).subtract({ days: 1 }).toString(),
    recurrence.until,
    lastDate,
  ].filter((date): date is string => Boolean(date));
  return { ...pattern, until: ends.sort()[0] };
}
