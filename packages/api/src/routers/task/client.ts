import { Database, DatabaseLive } from "@kompose/db";
import type { TaskTagInsert } from "@kompose/db/schema/tag";
import { tagTable, taskTagTable } from "@kompose/db/schema/tag";
import type {
  TaskInsert,
  TaskRecurrence,
  TaskSelect,
  TaskUpdate,
} from "@kompose/db/schema/task";
import { taskTable } from "@kompose/db/schema/task";
import {
  and,
  asc,
  desc,
  EmptyFilter,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import {
  generateOccurrences,
  PICK_START_TO_REPEAT,
  repeatEndsBeforeStart,
  sameRecurrence,
} from "../../lib/recurrence";
import type { DeleteScope, TaskListParams, UpdateScope } from "./contract";
import { InvalidTaskError, TaskNotFoundError } from "./errors";
import {
  buildOccurrenceRowsFromTask,
  type CheckedPattern,
  endedBefore,
  getDueDateForOccurrence,
  heirPattern,
  keepsEditedOccurrence,
  parsePlainDate,
  regeneratedOccurrenceRows,
  type SystemManagedTaskField,
  type TaskInsertInput,
  type TaskInsertRow,
  type TaskUpdateInput,
  withMovedDueDate,
} from "./occurrence-rows";

function stripSystemManagedTaskFields<
  T extends Partial<Record<SystemManagedTaskField, unknown>>,
>(input: T): Omit<T, SystemManagedTaskField> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = input;
  return rest;
}

/** Escape LIKE wildcards so a search for "50%" matches literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * The user's tasks with their tags, newest first. Params left unset don't
 * filter (Drizzle needs `EmptyFilter` there; `undefined` throws).
 */
const dbSelect = (userId: string, params: TaskListParams) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const text = params.query ? `%${escapeLike(params.query)}%` : null;
    return yield* db.query.taskTable.findMany({
      limit: params.limit ?? undefined,
      orderBy: { createdAt: "desc", id: "asc" },
      where: {
        dueDate: {
          gte: params.dueDateMin ?? EmptyFilter,
          lte: params.dueDateMax ?? EmptyFilter,
        },
        OR: text
          ? [{ title: { ilike: text } }, { description: { ilike: text } }]
          : EmptyFilter,
        startDate: {
          gte: params.startDateMin ?? EmptyFilter,
          lte: params.startDateMax ?? EmptyFilter,
        },
        status: params.status?.length ? { in: params.status } : EmptyFilter,
        // Tasks with any of the given tags
        tags: params.tagIds?.length
          ? { id: { in: params.tagIds } }
          : EmptyFilter,
        userId,
      },
      with: { tags: true },
    });
  });

const dbSelectById = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select()
      .from(taskTable)
      .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)));
  });

const dbSelectBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select()
      .from(taskTable)
      .where(
        and(
          eq(taskTable.seriesMasterId, seriesMasterId),
          eq(taskTable.userId, userId),
          gte(taskTable.startDate, fromDate)
        )
      )
      .orderBy(asc(taskTable.startDate));
  });

const dbSelectByIdsWithTags = (userId: string, taskIds: string[]) =>
  Effect.gen(function* () {
    if (taskIds.length === 0) {
      return [];
    }
    const db = yield* Database;
    return yield* db.query.taskTable.findMany({
      where: { id: { in: taskIds }, userId },
      with: { tags: true },
    });
  });

const dbInsert = (values: TaskInsertRow[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.insert(taskTable).values(values).returning();
  });

const dbUpdate = (
  userId: string,
  taskId: string,
  input: TaskUpdate & { isException?: boolean }
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .update(taskTable)
      .set(input)
      .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)))
      .returning();
  });

const dbDelete = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .delete(taskTable)
      .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)));
  });

/**
 * Pass a master's role and pattern to the series' next dated occurrence
 * (counting the dated ones left), the rest of the series following it. When
 * only undated ones (moved to the inbox) are left, they stand alone: an
 * undated task can't carry a repeat.
 */
const handOffMasterRole = Effect.fn("handOffMasterRole")(function* (
  userId: string,
  master: TaskSelect
) {
  const db = yield* Database;
  const rest = yield* db
    .select()
    .from(taskTable)
    .where(
      and(
        eq(taskTable.userId, userId),
        eq(taskTable.seriesMasterId, master.id),
        ne(taskTable.id, master.id)
      )
    )
    .orderBy(asc(taskTable.startDate));
  const dated = rest.filter((row) => row.startDate);
  const [heir] = dated;
  if (!heir) {
    return yield* dbDetachUndated(userId, master.id);
  }
  return yield* makeMaster(userId, {
    heir,
    recurrence: heirPattern(master.recurrence, dated.length),
    rows: rest,
  });
});

/**
 * Make `heir` the master of `rows` (itself among them), carrying
 * `recurrence`: the part of a series that outlives its master.
 */
const makeMaster = Effect.fn("makeMaster")(function* (
  userId: string,
  params: {
    heir: TaskSelect;
    recurrence: TaskSelect["recurrence"];
    rows: TaskSelect[];
  }
) {
  const db = yield* Database;
  const followed = yield* db
    .update(taskTable)
    .set({ seriesMasterId: params.heir.id })
    .where(
      and(eq(taskTable.userId, userId), inArray(taskTable.id, ids(params.rows)))
    )
    .returning();
  const [newMaster] = yield* dbUpdate(userId, params.heir.id, {
    recurrence: params.recurrence,
  });
  return newMaster
    ? [...followed.filter((row) => row.id !== params.heir.id), newMaster]
    : followed;
});

/**
 * Take an undated occurrence (moved to the inbox) out of its series, as a
 * standalone task: it has no place in a pattern. A master hands its role
 * to the next occurrence first.
 */
const releaseFromSeries = Effect.fn("releaseFromSeries")(function* (
  userId: string,
  task: TaskSelect
) {
  const handedOff =
    task.seriesMasterId === task.id
      ? yield* handOffMasterRole(userId, task)
      : [];
  const released = yield* dbUpdate(userId, task.id, STANDALONE);
  return [...handedOff, ...released];
});

const dbDeleteBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .delete(taskTable)
      .where(
        and(
          eq(taskTable.seriesMasterId, seriesMasterId),
          eq(taskTable.userId, userId),
          gte(taskTable.startDate, fromDate)
        )
      );
  });

const dbDeleteNonExceptionsBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string,
  /** A task to keep even if it isn't an exception yet. */
  keepId?: string
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .delete(taskTable)
      .where(
        and(
          eq(taskTable.seriesMasterId, seriesMasterId),
          eq(taskTable.userId, userId),
          gte(taskTable.startDate, fromDate),
          eq(taskTable.isException, false),
          keepId ? ne(taskTable.id, keepId) : undefined
        )
      )
      .returning({ id: taskTable.id });
  });

/** Dates from `fromDate` on that keep an exception (an occurrence edited alone). */
const dbSelectExceptionsBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select({ id: taskTable.id, startDate: taskTable.startDate })
      .from(taskTable)
      .where(
        and(
          eq(taskTable.seriesMasterId, seriesMasterId),
          eq(taskTable.userId, userId),
          gte(taskTable.startDate, fromDate),
          eq(taskTable.isException, true)
        )
      );
  });

/** A series' exceptions from `fromDate` on become standalone. */
const dbDetachExceptionsFrom = (params: {
  fromDate: string;
  seriesMasterId: string;
  userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .update(taskTable)
      .set({ isException: false, seriesMasterId: null })
      .where(
        and(
          eq(taskTable.userId, params.userId),
          eq(taskTable.seriesMasterId, params.seriesMasterId),
          eq(taskTable.isException, true),
          gte(taskTable.startDate, params.fromDate)
        )
      )
      .returning();
  });

/** Move a series' exceptions from `fromDate` on to another series. */
const dbMoveExceptionsToSeries = (params: {
  fromDate: string;
  fromSeriesMasterId: string;
  toSeriesMasterId: string;
  userId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .update(taskTable)
      .set({ seriesMasterId: params.toSeriesMasterId })
      .where(
        and(
          eq(taskTable.userId, params.userId),
          eq(taskTable.seriesMasterId, params.fromSeriesMasterId),
          eq(taskTable.isException, true),
          gte(taskTable.startDate, params.fromDate)
        )
      )
      .returning();
  });

const dbInsertTaskTags = (values: TaskTagInsert[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.insert(taskTagTable).values(values).returning();
  });

const dbDeleteTaskTagsForTasks = (taskIds: string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .delete(taskTagTable)
      .where(inArray(taskTagTable.taskId, taskIds));
  });

const dbSelectTagIdsForUser = (userId: string, tagIds: string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select({ id: tagTable.id })
      .from(tagTable)
      .where(and(eq(tagTable.userId, userId), inArray(tagTable.id, tagIds)));
  });

function normalizeTagIds(tagIds: string[]): string[] {
  return Array.from(new Set(tagIds.filter(Boolean)));
}

function buildTaskTagRows(
  taskIds: string[],
  tagIds: string[]
): TaskTagInsert[] {
  return taskIds.flatMap((taskId) =>
    tagIds.map((tagId) => ({ tagId, taskId }))
  );
}

/**
 * The given tag IDs, deduplicated and limited to tags this user owns, or
 * undefined when the input sets no tags.
 */
const resolveTagIdsForUser = (userId: string, tagIds: string[] | undefined) =>
  Effect.gen(function* () {
    if (tagIds === undefined) {
      return;
    }
    const uniqueTagIds = normalizeTagIds(tagIds);
    if (uniqueTagIds.length === 0) {
      return [] as string[];
    }

    const rows = yield* dbSelectTagIdsForUser(userId, uniqueTagIds);
    return rows.map((row) => row.id);
  });

const insertTaskTagsForTasks = (taskIds: string[], tagIds: string[]) =>
  Effect.gen(function* () {
    if (taskIds.length === 0 || tagIds.length === 0) {
      return;
    }

    yield* dbInsertTaskTags(buildTaskTagRows(taskIds, tagIds));
  });

const replaceTaskTagsForTasks = (taskIds: string[], tagIds: string[]) =>
  Effect.gen(function* () {
    // Replace tag links atomically by clearing then inserting.
    if (taskIds.length === 0) {
      return;
    }

    yield* dbDeleteTaskTagsForTasks(taskIds);
    if (tagIds.length === 0) {
      return;
    }

    yield* dbInsertTaskTags(buildTaskTagRows(taskIds, tagIds));
  });

// ============================================================================
// Business logic helpers
// ============================================================================

/** Resolve recurrence for comparison (occurrences may store null while master stores pattern). */
const resolveComparableRecurrence = Effect.fn("resolveComparableRecurrence")(
  function* (userId: string, task: TaskSelect) {
    if (task.recurrence || !task.seriesMasterId) {
      return task.recurrence ?? null;
    }

    const masterTasks = yield* dbSelectById(userId, task.seriesMasterId);
    return masterTasks[0]?.recurrence ?? null;
  }
);

/** Whether an edit to `task` changes its series' recurrence pattern. */
const changesSeriesRecurrence = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdateInput
) =>
  Effect.gen(function* () {
    // Omitted means unchanged. An explicit null ends the repeat ("Repeat:
    // None"), even on an occurrence that stores none of its own.
    if (input.recurrence === undefined) {
      return false;
    }
    const comparableRecurrence = yield* resolveComparableRecurrence(
      userId,
      task
    );
    return !sameRecurrence(input.recurrence, comparableRecurrence);
  });

/** Remove per-occurrence fields when updating a series in bulk. */
function buildSeriesUpdateBase(input: TaskUpdateInput): TaskUpdate {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        value !== undefined &&
        key !== "startDate" &&
        key !== "dueDate" &&
        key !== "startTime" &&
        key !== "recurrence" &&
        key !== "tagIds" &&
        // Status is the edited occurrence's own (Mark done with edits); the
        // later occurrences get the edits, not the status.
        key !== "status"
    )
  ) as TaskUpdate;
}

/** Parse a time string into Temporal.PlainTime (or null). */
function parsePlainTime(
  value: string | null | undefined
): Temporal.PlainTime | null {
  return value ? Temporal.PlainTime.from(value) : null;
}

interface DueDateScaleBase {
  baseDueDate: Temporal.PlainDate | null;
  baseStartDate: Temporal.PlainDate;
}

interface DateScaleContext {
  baseDueDate: Temporal.PlainDate | null;
  baseStartDate: Temporal.PlainDate | null;
  dueDateChanged: boolean;
  dueDateScaleBase: DueDateScaleBase | null;
  nextDueDate: Temporal.PlainDate | null;
  nextStartDate: Temporal.PlainDate | null;
  shouldClearDueDate: boolean;
  startDateChanged: boolean;
  startDateDelta: Temporal.Duration | null;
}

interface TimeScaleContext {
  baseStartTime: Temporal.PlainTime | null;
  nextStartTime: Temporal.PlainTime | null;
  startTimeChanged: boolean;
  startTimeDelta: Temporal.Duration | null;
  startTimeMode: "none" | "clear" | "set" | "shift";
}

/** Compute date-change context for a series update. */
function getDateScaleContext(
  task: TaskSelect,
  input: TaskUpdate
): DateScaleContext {
  // Base values from the edited occurrence.
  const baseStartDate = parsePlainDate(task.startDate);
  const baseDueDate = parsePlainDate(task.dueDate);

  // Presence flags distinguish "not provided" from "explicit null".
  const hasStartDate = input.startDate !== undefined;
  const hasDueDate = input.dueDate !== undefined;

  const startDateChanged = hasStartDate && input.startDate !== task.startDate;
  const dueDateChanged = hasDueDate && input.dueDate !== task.dueDate;

  const nextStartDate = hasStartDate
    ? parsePlainDate(input.startDate)
    : baseStartDate;
  const nextDueDate = hasDueDate ? parsePlainDate(input.dueDate) : baseDueDate;

  // Compute a shift delta when the start date changes.
  let startDateDelta: Temporal.Duration | null = null;
  if (startDateChanged && baseStartDate && nextStartDate) {
    startDateDelta = baseStartDate.until(nextStartDate, {
      largestUnit: "days",
    });
  }

  // Decide how to scale due dates for this update.
  let shouldClearDueDate = false;
  let dueDateScaleBase: DueDateScaleBase | null = null;

  if (dueDateChanged && nextDueDate === null) {
    shouldClearDueDate = true;
  } else if (dueDateChanged) {
    if (nextStartDate && nextDueDate) {
      dueDateScaleBase = {
        baseDueDate: nextDueDate,
        baseStartDate: nextStartDate,
      };
    } else if (baseStartDate && nextDueDate) {
      dueDateScaleBase = {
        baseDueDate: nextDueDate,
        baseStartDate,
      };
    }
  } else if (startDateChanged && baseStartDate && baseDueDate) {
    dueDateScaleBase = { baseDueDate, baseStartDate };
  }

  return {
    baseDueDate,
    baseStartDate,
    dueDateChanged,
    dueDateScaleBase,
    nextDueDate,
    nextStartDate,
    shouldClearDueDate,
    startDateChanged,
    startDateDelta,
  };
}

/** Compute time-change context for a series update. */
function getTimeScaleContext(
  task: TaskSelect,
  input: TaskUpdate
): TimeScaleContext {
  const baseStartTime = parsePlainTime(task.startTime);
  const hasStartTime = input.startTime !== undefined;
  const startTimeChanged = hasStartTime && input.startTime !== task.startTime;
  const nextStartTime = hasStartTime
    ? parsePlainTime(input.startTime)
    : baseStartTime;

  // Decide how to apply the time change across the series.
  let startTimeMode: "none" | "clear" | "set" | "shift" = "none";
  if (startTimeChanged) {
    if (nextStartTime) {
      startTimeMode = baseStartTime ? "shift" : "set";
    } else {
      startTimeMode = "clear";
    }
  }

  let startTimeDelta: Temporal.Duration | null = null;
  if (startTimeMode === "shift" && baseStartTime && nextStartTime) {
    startTimeDelta = baseStartTime.until(nextStartTime, {
      largestUnit: "minutes",
    });
  }

  return {
    baseStartTime,
    nextStartTime,
    startTimeChanged,
    startTimeDelta,
    startTimeMode,
  };
}

interface SeriesOccurrenceUpdateParams {
  baseUpdate: TaskUpdate;
  dateContext: DateScaleContext;
  inputStartTime: string | null | undefined;
  seriesTask: TaskSelect;
  timeContext: TimeScaleContext;
}

/** Build a per-occurrence update payload for a scaled series update. */
function buildSeriesOccurrenceUpdate(
  params: SeriesOccurrenceUpdateParams
): TaskUpdate {
  // Start with non-date fields that should apply to all occurrences.
  const update: TaskUpdate = { ...params.baseUpdate };

  // Track the effective start date for this occurrence (post-shift).
  let effectiveStartDate = params.seriesTask.startDate
    ? Temporal.PlainDate.from(params.seriesTask.startDate)
    : null;

  if (params.dateContext.startDateChanged) {
    if (!params.dateContext.nextStartDate) {
      update.startDate = null;
      effectiveStartDate = null;
    } else if (params.dateContext.startDateDelta && effectiveStartDate) {
      const shifted = effectiveStartDate.add(params.dateContext.startDateDelta);
      update.startDate = shifted.toString();
      effectiveStartDate = shifted;
    } else {
      update.startDate = params.dateContext.nextStartDate.toString();
      effectiveStartDate = params.dateContext.nextStartDate;
    }
  }

  // Scale due dates based on the chosen offset strategy.
  if (params.dateContext.shouldClearDueDate) {
    update.dueDate = null;
  } else if (params.dateContext.dueDateScaleBase && effectiveStartDate) {
    update.dueDate = getDueDateForOccurrence({
      baseDueDate: params.dateContext.dueDateScaleBase.baseDueDate,
      baseStartDate: params.dateContext.dueDateScaleBase.baseStartDate,
      occurrenceDate: effectiveStartDate,
    });
  }

  // Scale start times across the series when requested.
  if (params.timeContext.startTimeMode === "clear") {
    update.startTime = null;
  } else if (
    params.timeContext.startTimeMode === "set" &&
    params.inputStartTime
  ) {
    update.startTime = params.inputStartTime;
  } else if (
    params.timeContext.startTimeMode === "shift" &&
    params.timeContext.startTimeDelta &&
    params.seriesTask.startTime
  ) {
    update.startTime = Temporal.PlainTime.from(params.seriesTask.startTime)
      .add(params.timeContext.startTimeDelta)
      .toString();
  }

  return update;
}

const REPEAT_ENDS_BEFORE_START = "The repeat ends before the task starts.";

/**
 * Check a pattern a create or edit sets (a new task's, a series' new one,
 * or one that makes a lone task repeat). It counts from the start date, so
 * it needs one, and one ending before it has no occurrences and would
 * replace a series with nothing.
 */
const checkPattern = Effect.fn("checkPattern")(function* (
  recurrence: TaskRecurrence,
  startDate: string | null | undefined
) {
  if (!startDate) {
    return yield* Effect.fail(
      new InvalidTaskError({ message: PICK_START_TO_REPEAT })
    );
  }
  if (repeatEndsBeforeStart(recurrence, startDate)) {
    return yield* Effect.fail(
      new InvalidTaskError({ message: REPEAT_ENDS_BEFORE_START })
    );
  }
  const checked: CheckedPattern = { recurrence, startDate };
  return checked;
});

/** Build task rows for a recurring series */
function buildRecurringTaskRows(
  userId: string,
  input: TaskInsert,
  recurrence: TaskRecurrence,
  startDate: string
): TaskInsertRow[] {
  const masterId = uuidv7();
  const parsedStartDate = Temporal.PlainDate.from(startDate);
  const parsedDueDate = input.dueDate
    ? Temporal.PlainDate.from(input.dueDate)
    : null;
  const occurrenceDates = generateOccurrences(recurrence, parsedStartDate);

  return occurrenceDates.map((date, index) => {
    const id = index === 0 ? masterId : uuidv7();
    return {
      ...input,
      // Keep the due date offset aligned with each occurrence's start date.
      dueDate: getDueDateForOccurrence({
        baseDueDate: parsedDueDate,
        baseStartDate: parsedStartDate,
        occurrenceDate: date,
      }),
      id,
      isException: false,
      recurrence: index === 0 ? recurrence : null,
      seriesMasterId: masterId,
      startDate: date.toString(),
      userId,
    };
  });
}

/**
 * Whether a "this" update writes the task: a field changes, or the tags of
 * a series occurrence do (that makes it an exception, so a later pattern
 * change keeps it and its tags).
 */
function editsThisTask(
  task: TaskSelect,
  hasDbUpdates: boolean,
  tagIds: string[] | undefined
): boolean {
  return hasDbUpdates || (task.seriesMasterId !== null && tagIds !== undefined);
}

/**
 * An update's written rows, and which of them take the edit's tags (a
 * pattern change keeps other exceptions' own tags).
 */
interface WrittenRows {
  retagIds: string[];
  rows: TaskSelect[];
}

function allRetagged(rows: TaskSelect[]): WrittenRows {
  return { retagIds: ids(rows), rows };
}

/** Writes an update's rows for its scope (no tags), returning them. */
const writeTaskUpdate = Effect.fn("writeTaskUpdate")(function* (params: {
  dbInput: TaskUpdateInput;
  hasDbUpdates: boolean;
  /** The pattern the edit sets, checked. */
  newPattern: CheckedPattern | null;
  normalizedTagIds: string[] | undefined;
  recurrenceChanged: boolean;
  scope: UpdateScope;
  task: TaskSelect;
  userId: string;
}) {
  const { dbInput, task, userId } = params;
  if (task.seriesMasterId && params.scope === "following") {
    return yield* updateFollowing({
      input: dbInput,
      newPattern: params.newPattern,
      recurrenceChanged: params.recurrenceChanged,
      task,
      userId,
    });
  }
  if (!task.seriesMasterId && params.newPattern) {
    return allRetagged(
      yield* convertToRecurring(userId, task, dbInput, params.newPattern)
    );
  }
  if (editsThisTask(task, params.hasDbUpdates, params.normalizedTagIds)) {
    // Edit this task alone, marked as an exception to its series.
    return allRetagged(
      yield* dbUpdate(userId, task.id, {
        ...dbInput,
        isException: true,
      })
    );
  }
  return allRetagged([task]);
});

/** A task's series fields once it's out of any series. */
const STANDALONE = {
  isException: false,
  recurrence: null,
  seriesMasterId: null,
} as const;

/** A series occurrence with a start date, which "following" edits need. */
type DatedSeriesTask = TaskSelect & {
  seriesMasterId: string;
  startDate: string;
};

function isDatedSeriesTask(task: TaskSelect): task is DatedSeriesTask {
  return Boolean(task.seriesMasterId && task.startDate);
}

/**
 * Replace this and later non-exception occurrences with a new recurrence
 * pattern. The old series ends before the edit's boundary (the earlier of
 * the edited occurrence's original and new dates); the new one starts
 * where it now is. Exceptions (edited alone, or done) stay, and the new
 * pattern leaves their dates out instead of doubling them.
 *
 * The edited occurrence stays too, taking the edits, when it is an
 * exception, the edit sets its status (Mark done with a pattern change), or
 * it moves onto a date another kept task holds: it becomes the new series'
 * master, carrying the pattern, so a moved or finished occurrence is never
 * lost or doubled.
 */
const regenerateOccurrences = Effect.fn("regenerateOccurrences")(function* (
  userId: string,
  task: DatedSeriesTask,
  edit: TaskUpdateInput,
  /** The new pattern, checked; null ends the repeat ("Repeat: None"). */
  pattern: CheckedPattern | null
) {
  const input = withMovedDueDate(task, edit);
  const { recurrence: _sentRecurrence, ...occurrenceFields } = input;
  // The series splits where the edit starts: the earlier of the edited
  // occurrence's original and new dates, so a move earlier doesn't leave
  // old occurrences under the new ones.
  const boundary =
    input.startDate && input.startDate < task.startDate
      ? input.startDate
      : task.startDate;
  // The dates other exceptions from the boundary on hold: they stay, and
  // the new pattern leaves their dates out.
  const otherKeptDates = new Set(
    pattern
      ? (yield* dbSelectExceptionsBySeriesFrom(
          userId,
          task.seriesMasterId,
          boundary
        )).flatMap((row) =>
          row.id !== task.id && row.startDate ? [row.startDate] : []
        )
      : []
  );
  // Ending the repeat ("Repeat: None") keeps the edited task, as a
  // standalone task, and drops the later ordinary occurrences.
  const keepEdited =
    !pattern ||
    keepsEditedOccurrence({
      input,
      keptDates: otherKeptDates,
      start: pattern.startDate,
      task,
    });
  // The earlier part of the series stops before the edit, so its master no
  // longer claims to repeat past it. First, while the master is still
  // there: a split before it deletes it below, and its undated and earlier
  // occurrences need it to move to a series of their own.
  const ended = yield* endSeriesBefore(userId, task, boundary);
  const deletedIds = new Set(
    ids(
      yield* dbDeleteNonExceptionsBySeriesFrom(
        userId,
        task.seriesMasterId,
        boundary,
        keepEdited ? task.id : undefined
      )
    )
  );
  // Rows the delete removed don't go back to clients.
  const endedMaster = ended.filter((row) => !deletedIds.has(row.id));

  // A kept edited occurrence is where the new series starts, so it becomes
  // its master and carries the pattern (even when the pattern adds no other
  // dates: Daily x1 from a done occurrence). Ending the repeat leaves it a
  // standalone task.
  const anchorSeries: Partial<TaskUpdateInput> = pattern
    ? {
        isException: true,
        recurrence: pattern.recurrence,
        seriesMasterId: task.id,
      }
    : STANDALONE;
  const updatedAnchor = keepEdited
    ? yield* dbUpdate(userId, task.id, { ...occurrenceFields, ...anchorSeries })
    : [];

  if (!pattern) {
    // Exceptions after the boundary (moved, renamed, or done alone) become
    // standalone tasks rather than members of a series that no longer
    // repeats there.
    const detached = yield* dbDetachExceptionsFrom({
      fromDate: boundary,
      seriesMasterId: task.seriesMasterId,
      userId,
    });
    return {
      retagIds: ids(updatedAnchor),
      rows: [...updatedAnchor, ...endedMaster, ...detached],
    };
  }

  const seriesMasterId = keepEdited ? task.id : uuidv7();
  const taskRows = regeneratedOccurrenceRows({
    input,
    keepEdited,
    keptDates: otherKeptDates,
    pattern,
    seriesMasterId,
    task,
    userId,
  });
  const inserted = taskRows.length > 0 ? yield* dbInsert(taskRows) : [];
  // Kept occurrences from the boundary on join the new series as
  // exceptions, so they show and follow its pattern rather than the old one.
  const moved = yield* dbMoveExceptionsToSeries({
    fromDate: boundary,
    fromSeriesMasterId: task.seriesMasterId,
    toSeriesMasterId: seriesMasterId,
    userId,
  });
  // Every changed row goes back, once, latest write wins (so clients see
  // the moved exceptions in their new series), but only the edited
  // occurrence and the new rows take the edit's tags: the other kept
  // exceptions keep their own.
  const rows = new Map(
    [...updatedAnchor, ...endedMaster, ...inserted, ...moved].map((row) => [
      row.id,
      row,
    ])
  );
  return {
    retagIds: [...(keepEdited ? [task.id] : []), ...ids(inserted)],
    rows: [...rows.values()],
  };
});

/**
 * Ends the series' pattern before `boundary` (when `task` isn't its first):
 * the master keeps its days up to there, and stops claiming the later ones,
 * deleted or replaced by a pattern change or "Repeat: None".
 */
const endSeriesBefore = Effect.fn("endSeriesBefore")(function* (
  userId: string,
  task: DatedSeriesTask,
  /** The first date the earlier part no longer covers. */
  boundary: string
) {
  if (task.seriesMasterId === task.id) {
    return [
      ...(yield* handOffEarlierPart(userId, task, boundary)),
      ...(yield* dbDetachUndated(userId, task.id)),
    ];
  }
  const [master] = yield* dbSelectById(userId, task.seriesMasterId);
  // A master already gone (older data): its undated occurrences stand alone.
  if (!master) {
    return yield* dbDetachUndated(userId, task.seriesMasterId);
  }
  if (!master.recurrence) {
    return [] as TaskSelect[];
  }
  // The master was moved to the inbox: it can't carry the earlier part's
  // pattern, so that part becomes a series of its own (or a lone task), and
  // the master and any other undated occurrences stand alone.
  if (!master.startDate) {
    const handedOff = yield* handOffEarlierPart(userId, master, boundary);
    const detached = yield* dbDetachUndated(userId, master.id);
    const released = yield* dbUpdate(userId, master.id, STANDALONE);
    return [...handedOff, ...detached, ...released];
  }
  // The split starts on or before the master, so the master's pattern goes
  // rather than ending before its own start. Occurrences before the split
  // (the master was moved later alone) keep the original pattern as a
  // series of their own first.
  if (boundary <= master.startDate) {
    const handedOff = yield* handOffEarlierPart(userId, master, boundary);
    const detached = yield* dbDetachUndated(userId, master.id);
    const cleared = yield* dbUpdate(userId, master.id, { recurrence: null });
    return [...handedOff, ...detached, ...cleared];
  }
  const db = yield* Database;
  const [last] = yield* db
    .select({ startDate: taskTable.startDate })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.userId, userId),
        eq(taskTable.seriesMasterId, master.id),
        lt(taskTable.startDate, boundary)
      )
    )
    .orderBy(desc(taskTable.startDate))
    .limit(1);
  return yield* dbUpdate(userId, master.id, {
    recurrence: endedBefore(master.recurrence, boundary, last?.startDate),
  });
});

/**
 * A series' undated occurrences (moved to the inbox alone) have no place
 * before or after a split, so when a split starts at or before their master
 * they become standalone tasks rather than members of a series that's
 * changed or gone.
 */
const dbDetachUndated = (userId: string, seriesMasterId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .update(taskTable)
      .set(STANDALONE)
      .where(
        and(
          eq(taskTable.userId, userId),
          eq(taskTable.seriesMasterId, seriesMasterId),
          ne(taskTable.id, seriesMasterId),
          isNull(taskTable.startDate)
        )
      )
      .returning();
  });

/**
 * Occurrences of `master`'s series before `boundary` (the master was moved
 * later alone, then the series split at or before it) keep the original
 * pattern, ended the day before, under the earliest of them as their own
 * master, so what happens to the master from there on doesn't reach them.
 */
const handOffEarlierPart = Effect.fn("handOffEarlierPart")(function* (
  userId: string,
  master: Pick<TaskSelect, "id" | "recurrence">,
  boundary: string
) {
  const db = yield* Database;
  const earlier = yield* db
    .select()
    .from(taskTable)
    .where(
      and(
        eq(taskTable.userId, userId),
        eq(taskTable.seriesMasterId, master.id),
        ne(taskTable.id, master.id),
        lt(taskTable.startDate, boundary)
      )
    )
    .orderBy(asc(taskTable.startDate));
  const [heir] = earlier;
  if (!(heir && master.recurrence)) {
    return [] as TaskSelect[];
  }
  return yield* makeMaster(userId, {
    heir,
    recurrence: endedBefore(
      master.recurrence,
      boundary,
      earlier.at(-1)?.startDate
    ),
    rows: earlier,
  });
});

function ids(rows: Pick<TaskSelect, "id">[]): string[] {
  return rows.map((row) => row.id);
}

/** Update a recurring series by scaling date/time offsets across occurrences. */
const updateSeriesWithScaledDates = Effect.fn("updateSeriesWithScaledDates")(
  function* (userId: string, task: DatedSeriesTask, input: TaskUpdateInput) {
    const seriesTasks = yield* dbSelectBySeriesFrom(
      userId,
      task.seriesMasterId,
      task.startDate
    );

    // Build a base update object (exclude per-occurrence date/time fields).
    const baseUpdate = buildSeriesUpdateBase(input);

    // Compute date/time scaling rules based on the edited occurrence.
    const dateContext = getDateScaleContext(task, input);
    const timeContext = getTimeScaleContext(task, input);

    const updatedTasks: TaskSelect[] = [];

    for (const seriesTask of seriesTasks) {
      const update = buildSeriesOccurrenceUpdate({
        baseUpdate,
        dateContext,
        inputStartTime: input.startTime,
        seriesTask,
        timeContext,
      });
      // The status goes on the edited occurrence alone, which becomes an
      // exception (so a later pattern change keeps it).
      if (seriesTask.id === task.id && input.status !== undefined) {
        update.status = input.status;
        update.isException = true;
      }

      // Avoid issuing a no-op update.
      if (Object.keys(update).length === 0) {
        updatedTasks.push(seriesTask);
        continue;
      }

      const updated = yield* dbUpdate(userId, seriesTask.id, update);
      updatedTasks.push(...updated);
    }

    return updatedTasks;
  }
);

/** Convert a non-recurring task to a recurring series */
const convertToRecurring = Effect.fn("convertToRecurring")(function* (
  userId: string,
  task: TaskSelect,
  input: TaskUpdateInput,
  pattern: CheckedPattern
) {
  // Generate occurrence dates (first one is the existing task's date)
  const seriesStartDate = Temporal.PlainDate.from(pattern.startDate);
  const occurrenceDates = generateOccurrences(
    pattern.recurrence,
    seriesStartDate
  );

  // Update the existing task to be the master
  const updatedMaster = yield* dbUpdate(userId, task.id, {
    ...input,
    isException: false,
    seriesMasterId: task.id,
  });

  // If only one occurrence (the master), we're done
  if (occurrenceDates.length <= 1) {
    return updatedMaster;
  }

  // Build additional occurrence rows (skip first since that's the master)
  const additionalRows = buildOccurrenceRowsFromTask({
    input,
    occurrenceDates: occurrenceDates.slice(1),
    seriesMasterId: task.id,
    seriesStartDate,
    task,
    userId,
  });

  const insertedOccurrences = yield* dbInsert(additionalRows);
  return [...updatedMaster, ...insertedOccurrences];
});

/**
 * A repeat change on an undated occurrence (moved to the inbox): it leaves
 * its series as a standalone task, and a new pattern makes it a series of
 * its own, from the start date the edit gives it.
 */
const repatternUndated = Effect.fn("repatternUndated")(function* (
  userId: string,
  task: TaskSelect,
  input: TaskUpdateInput,
  newPattern: CheckedPattern | null
) {
  const released = yield* releaseFromSeries(userId, task);
  const standalone: TaskSelect = { ...task, ...STANDALONE };
  const rows = newPattern
    ? yield* convertToRecurring(userId, standalone, input, newPattern)
    : yield* dbUpdate(userId, task.id, { ...input, recurrence: null });
  const written = new Map([...released, ...rows].map((row) => [row.id, row]));
  return { retagIds: ids(rows), rows: [...written.values()] };
});

/** Handle scope=following update for recurring task */
const updateFollowing = Effect.fn("updateFollowing")(function* (params: {
  input: TaskUpdateInput;
  /** The pattern the edit sets, checked. */
  newPattern: CheckedPattern | null;
  recurrenceChanged: boolean;
  task: TaskSelect;
  userId: string;
}) {
  const { input, recurrenceChanged, task, userId } = params;
  // Without a start date there is no "following"; edit this occurrence alone.
  if (!isDatedSeriesTask(task)) {
    if (recurrenceChanged) {
      return yield* repatternUndated(userId, task, input, params.newPattern);
    }
    return allRetagged(
      yield* dbUpdate(userId, task.id, { ...input, isException: true })
    );
  }

  // If recurrence pattern is changing, regenerate future occurrences (inside
  // updateTask's transaction, like everything below).
  if (recurrenceChanged) {
    return yield* regenerateOccurrences(userId, task, input, params.newPattern);
  }

  // Moving it to the inbox takes this occurrence alone: an undated task has
  // no place in the pattern, and the later ones keep their dates.
  if (input.startDate === null) {
    return allRetagged(
      yield* dbUpdate(userId, task.id, { ...input, isException: true })
    );
  }

  // No recurrence change: update this and following with scaled date/time
  // offsets.
  return allRetagged(yield* updateSeriesWithScaledDates(userId, task, input));
});

// ============================================================================
// Service Definition (Effect.Service + Effect.fn pattern)
// ============================================================================

export class TaskService extends Context.Service<TaskService>()("TaskService", {
  make: Effect.gen(function* () {
    const listTasks = Effect.fn("TaskService.listTasks")(function* (
      userId: string,
      params: TaskListParams
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      return yield* dbSelect(userId, params);
    });

    const getTask = Effect.fn("TaskService.getTask")(function* (
      userId: string,
      taskId: string
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      const [task] = yield* dbSelectByIdsWithTags(userId, [taskId]);
      if (!task) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId }));
      }
      return task;
    });

    const createTask = Effect.fn("TaskService.createTask")(function* (
      userId: string,
      input: TaskInsertInput
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      const { tagIds, ...unsafeTaskInput } = input;
      const taskInput = stripSystemManagedTaskFields(unsafeTaskInput);
      const normalizedTagIds = yield* resolveTagIdsForUser(userId, tagIds);

      // Non-recurring task: simple insert
      if (!taskInput.recurrence) {
        const masterId = uuidv7();
        const tasks = yield* dbInsert([{ ...taskInput, id: masterId, userId }]);
        if (normalizedTagIds) {
          yield* insertTaskTagsForTasks([masterId], normalizedTagIds);
        }
        return yield* dbSelectByIdsWithTags(
          userId,
          tasks.map((task) => task.id)
        );
      }

      // Recurring task: validate and generate occurrences
      const pattern = yield* checkPattern(
        taskInput.recurrence,
        taskInput.startDate
      );
      const taskRows = buildRecurringTaskRows(
        userId,
        taskInput,
        pattern.recurrence,
        pattern.startDate
      );
      const tasks = yield* dbInsert(taskRows);
      if (normalizedTagIds) {
        yield* insertTaskTagsForTasks(
          tasks.map((task) => task.id),
          normalizedTagIds
        );
      }
      return yield* dbSelectByIdsWithTags(
        userId,
        tasks.map((task) => task.id)
      );
    });

    const updateTask = Effect.fn("TaskService.updateTask")(function* (
      userId: string,
      taskId: string,
      input: TaskUpdateInput,
      scope: UpdateScope
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      yield* Effect.annotateCurrentSpan("taskId", taskId);
      yield* Effect.annotateCurrentSpan("scope", scope);
      // Get the task to check if it's recurring
      const [task] = yield* dbSelectById(userId, taskId);

      if (!task) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId }));
      }

      const { tagIds, ...unsafeDbInput } = input;
      const sent = stripSystemManagedTaskFields(unsafeDbInput);
      const normalizedTagIds = yield* resolveTagIdsForUser(userId, tagIds);
      const changesPattern =
        task.seriesMasterId !== null &&
        (yield* changesSeriesRecurrence(userId, task, sent));
      // A series' pattern sent along unchanged is no edit: only its master
      // carries it, so it must not be written onto an occurrence.
      const { recurrence: _pattern, ...withoutPattern } = sent;
      const dbInput: TaskUpdateInput =
        task.seriesMasterId !== null && !changesPattern ? withoutPattern : sent;
      const hasDbUpdates = Object.keys(dbInput).length > 0;
      // One occurrence can't repeat differently from its series: a new
      // pattern (or "Repeat: None") applies from this occurrence on.
      if (changesPattern && scope === "this") {
        return yield* Effect.fail(
          new InvalidTaskError({
            message:
              'Changing how a task repeats applies to this and following occurrences: use scope "following".',
          })
        );
      }
      // Checked before anything is deleted.
      const newPattern = dbInput.recurrence
        ? yield* checkPattern(
            dbInput.recurrence,
            dbInput.startDate === undefined ? task.startDate : dbInput.startDate
          )
        : null;

      // Regenerating a series replaces its rows. When the edit doesn't set
      // tags, read this task's tags now so the new rows can keep them.
      const carriedTagIds =
        normalizedTagIds === undefined && changesPattern
          ? ((yield* dbSelectByIdsWithTags(userId, [taskId]))[0]?.tags.map(
              (tag) => tag.id
            ) ?? [])
          : [];

      // Every write (the rows, then their tags) in one transaction: drizzle's
      // effect driver scopes it to this fiber, so the helpers' queries join
      // it, and a failure leaves nothing half-saved.
      const db = yield* Database;
      const updatedTasks = yield* db.transaction(() =>
        Effect.gen(function* () {
          const written = yield* writeTaskUpdate({
            dbInput,
            hasDbUpdates,
            newPattern,
            normalizedTagIds,
            recurrenceChanged: changesPattern,
            scope,
            task,
            userId,
          });

          const tagIdsToSet =
            normalizedTagIds ??
            (carriedTagIds.length > 0 ? carriedTagIds : undefined);
          if (tagIdsToSet !== undefined) {
            yield* replaceTaskTagsForTasks(written.retagIds, tagIdsToSet);
          }
          return written.rows;
        })
      );

      return yield* dbSelectByIdsWithTags(
        userId,
        updatedTasks.map((updatedTask) => updatedTask.id)
      );
    });

    const deleteTask = Effect.fn("TaskService.deleteTask")(function* (
      userId: string,
      taskId: string,
      scope: DeleteScope
    ) {
      yield* Effect.annotateCurrentSpan("userId", userId);
      yield* Effect.annotateCurrentSpan("taskId", taskId);
      yield* Effect.annotateCurrentSpan("scope", scope);
      // Get the task to check if it's recurring
      const [task] = yield* dbSelectById(userId, taskId);

      // Task already deleted or doesn't exist
      if (!task) {
        return;
      }

      // Each transaction below is scoped to this fiber by drizzle's effect
      // driver, so the helpers' queries join it.
      const db = yield* Database;
      // Without a start date there's no "following": delete it alone.
      const alone = scope === "this" || !task.startDate;
      // A series master deleted alone hands its role and pattern to the
      // next occurrence, so the rest keep a master to read the pattern from.
      if (alone && task.seriesMasterId === task.id) {
        yield* db.transaction(() =>
          Effect.gen(function* () {
            yield* handOffMasterRole(userId, task);
            yield* dbDelete(userId, taskId);
          })
        );
        return;
      }

      // Non-recurring or alone: delete single task
      if (alone || !isDatedSeriesTask(task)) {
        yield* dbDelete(userId, taskId);
        return;
      }

      // scope=following: delete this task and all future tasks in series.
      // What's left before it ends its pattern there, or, when this is a
      // master moved later alone, keeps it as a series of its own.
      yield* db.transaction(() =>
        Effect.gen(function* () {
          yield* endSeriesBefore(userId, task, task.startDate);
          yield* dbDeleteBySeriesFrom(
            userId,
            task.seriesMasterId,
            task.startDate
          );
        })
      );
    });

    return { createTask, deleteTask, getTask, listTasks, updateTask };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DatabaseLive)
  );
}
