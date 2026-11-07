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
 * Pure planning for a recurring series' rows: which occurrences a pattern
 * change keeps and creates, and with what fields. The task client applies
 * the plan to the database.
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
  const baseDueDate = parsePlainDate(input.dueDate ?? task.dueDate);

  return params.occurrenceDates.map((date) => ({
    description: input.description ?? task.description,
    dueDate: getDueDateForOccurrence({
      baseDueDate,
      baseStartDate: params.seriesStartDate,
      occurrenceDate: date,
    }),
    durationMinutes: input.durationMinutes ?? task.durationMinutes,
    id: uuidv7(),
    isException: false,
    links: input.links ?? task.links,
    recurrence: null,
    seriesMasterId: params.seriesMasterId,
    startDate: date.toString(),
    startTime: input.startTime ?? task.startTime,
    status: "todo",
    title: input.title ?? task.title,
    userId: params.userId,
  }));
}

/**
 * Whether a "this and following" pattern change keeps the edited occurrence
 * (and gives it the edits, without the pattern) instead of replacing it: it
 * is an exception already, or the edit sets its status (Mark done).
 */
export function keepsEditedOccurrence(
  task: Pick<TaskSelect, "isException">,
  input: Pick<TaskUpdateInput, "status">
): boolean {
  return task.isException || input.status !== undefined;
}

/**
 * The new occurrences for a "this and following" pattern change, from the
 * edited occurrence's original date (`task.startDate`). Dates in
 * `keptDates` (exceptions, including the kept edited occurrence wherever it
 * moved) are left out. The first row is the new series master. New
 * occurrences start open; when the edited occurrence is replaced, the new
 * one on its date keeps its status.
 */
export function regeneratedOccurrenceRows(params: {
  input: TaskUpdateInput & {
    recurrence: NonNullable<TaskUpdateInput["recurrence"]>;
  };
  keepEdited: boolean;
  keptDates: ReadonlySet<string>;
  seriesMasterId: string;
  task: TaskSelect & { startDate: string };
  userId: string;
}): TaskInsertRow[] {
  const { input, task } = params;
  const seriesStartDate = Temporal.PlainDate.from(task.startDate);
  const occurrenceDates = generateOccurrences(
    input.recurrence,
    seriesStartDate
  ).filter((date) => !params.keptDates.has(date.toString()));
  return buildOccurrenceRowsFromTask({
    input,
    occurrenceDates,
    seriesMasterId: params.seriesMasterId,
    seriesStartDate,
    task,
    userId: params.userId,
  }).map((row, index) => ({
    ...row,
    ...(index === 0
      ? { id: params.seriesMasterId, recurrence: input.recurrence }
      : {}),
    ...(!params.keepEdited && row.startDate === task.startDate
      ? { status: task.status }
      : {}),
  }));
}
