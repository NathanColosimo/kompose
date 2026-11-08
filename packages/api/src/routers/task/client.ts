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
import { and, asc, EmptyFilter, eq, gte, inArray, ne, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { generateOccurrences } from "../../lib/recurrence";
import type { DeleteScope, TaskListParams, UpdateScope } from "./contract";
import { InvalidTaskError, TaskNotFoundError } from "./errors";
import {
  buildOccurrenceRowsFromTask,
  getDueDateForOccurrence,
  keepsEditedOccurrence,
  parsePlainDate,
  regeneratedOccurrenceRows,
  type SystemManagedTaskField,
  type TaskInsertInput,
  type TaskInsertRow,
  type TaskUpdateInput,
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
      );
  });

/** Dates from `fromDate` on that keep an exception (an occurrence edited alone). */
const dbSelectExceptionDatesBySeriesFrom = (
  userId: string,
  seriesMasterId: string,
  fromDate: string
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select({ startDate: taskTable.startDate })
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

/** A series' exceptions from `fromDate` on (but `editedId`) become standalone. */
const dbDetachExceptionsFrom = (params: {
  editedId: string;
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
          gte(taskTable.startDate, params.fromDate),
          ne(taskTable.id, params.editedId)
        )
      )
      .returning();
  });

/** Move a series' exceptions from `fromDate` on (and `editedId`) to another series. */
const dbMoveExceptionsToSeries = (params: {
  editedId: string;
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
          or(
            gte(taskTable.startDate, params.fromDate),
            eq(taskTable.id, params.editedId)
          )
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

/** Compare recurrence objects (undefined treated as null). */
function isSameRecurrence(
  a: TaskRecurrence | null | undefined,
  b: TaskRecurrence | null | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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
    // None"), even on an occurrence that stores none of its own: clients
    // omit recurrence when it didn't change.
    if (input.recurrence === undefined) {
      return false;
    }
    const comparableRecurrence = yield* resolveComparableRecurrence(
      userId,
      task
    );
    return !isSameRecurrence(input.recurrence, comparableRecurrence);
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
  normalizedTagIds: string[] | undefined;
  recurrenceChanged: boolean;
  scope: UpdateScope;
  task: TaskSelect;
  userId: string;
}) {
  const { dbInput, task, userId } = params;
  if (task.seriesMasterId && params.scope === "following") {
    return yield* updateFollowing(
      userId,
      task,
      dbInput,
      params.recurrenceChanged
    );
  }
  if (!task.seriesMasterId && dbInput.recurrence) {
    return allRetagged(yield* convertToRecurring(userId, task, dbInput));
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
 * pattern. The old series ends before the edited occurrence's original
 * date; the new one starts where it now is (its new date when the edit
 * moves it). Exceptions (edited
 * alone, or done) stay, and the new pattern leaves their dates out instead
 * of doubling them.
 *
 * The edited occurrence stays too when it is an exception or the edit sets
 * its status (Mark done with a pattern change): it takes the edits, without
 * the pattern, so a moved or finished occurrence is never lost or doubled.
 */
const regenerateOccurrences = Effect.fn("regenerateOccurrences")(function* (
  userId: string,
  task: DatedSeriesTask,
  input: TaskUpdateInput
) {
  const { recurrence, ...occurrenceFields } = input;
  // Ending the repeat ("Repeat: None") keeps the edited task, as a
  // standalone task, and drops the later ordinary occurrences.
  const ending = !recurrence;
  const keepEdited = ending || keepsEditedOccurrence(task, input);
  yield* dbDeleteNonExceptionsBySeriesFrom(
    userId,
    task.seriesMasterId,
    task.startDate,
    keepEdited ? task.id : undefined
  );

  const updatedAnchor = keepEdited
    ? yield* dbUpdate(userId, task.id, {
        ...occurrenceFields,
        isException: !ending,
        recurrence: null,
        ...(ending ? { seriesMasterId: null } : {}),
      })
    : [];

  // The earlier part of the series stops the day before the edit, so its
  // master no longer claims to repeat past it.
  const endedMaster = yield* endSeriesBefore(userId, task);

  if (!recurrence) {
    // Exceptions after the boundary (moved, renamed, or done alone) become
    // standalone tasks rather than members of a series that no longer
    // repeats there.
    const detached = yield* dbDetachExceptionsFrom({
      editedId: task.id,
      fromDate: task.startDate,
      seriesMasterId: task.seriesMasterId,
      userId,
    });
    return {
      retagIds: ids(updatedAnchor),
      rows: [...updatedAnchor, ...endedMaster, ...detached],
    };
  }

  const keptDates = new Set(
    (yield* dbSelectExceptionDatesBySeriesFrom(
      userId,
      task.seriesMasterId,
      task.startDate
    )).flatMap((row) => (row.startDate ? [row.startDate] : []))
  );
  if (updatedAnchor[0]?.startDate) {
    keptDates.add(updatedAnchor[0].startDate);
  }
  const seriesMasterId = uuidv7();
  const taskRows = regeneratedOccurrenceRows({
    input: { ...input, recurrence },
    keepEdited,
    keptDates,
    seriesMasterId,
    task,
    userId,
  });
  if (taskRows.length === 0) {
    return {
      retagIds: ids(updatedAnchor),
      rows: [...updatedAnchor, ...endedMaster],
    };
  }
  const inserted = yield* dbInsert(taskRows);
  // Kept occurrences from the boundary on (and the edited one, wherever it
  // moved) join the new series as exceptions, so they show and follow its
  // pattern rather than the old one.
  const moved = yield* dbMoveExceptionsToSeries({
    editedId: task.id,
    fromDate: task.startDate,
    fromSeriesMasterId: task.seriesMasterId,
    toSeriesMasterId: seriesMasterId,
    userId,
  });
  // Every changed row goes back (so clients see the moved exceptions in
  // their new series), but only the edited occurrence and the new rows take
  // the edit's tags: the other kept exceptions keep their own.
  const edited = moved.filter((row) => row.id === task.id);
  return {
    retagIds: [...ids(edited), ...ids(inserted)],
    rows: [...moved, ...inserted, ...endedMaster],
  };
});

/**
 * Ends the series' pattern the day before `task` (when `task` isn't its
 * first): the master keeps its days up to there, and stops claiming the
 * ones a pattern change or "Repeat: None" replaced.
 */
const endSeriesBefore = Effect.fn("endSeriesBefore")(function* (
  userId: string,
  task: DatedSeriesTask
) {
  if (task.seriesMasterId === task.id) {
    return [] as TaskSelect[];
  }
  const [master] = yield* dbSelectById(userId, task.seriesMasterId);
  if (!master?.recurrence) {
    return [] as TaskSelect[];
  }
  const { count: _count, ...pattern } = master.recurrence;
  return yield* dbUpdate(userId, master.id, {
    recurrence: {
      ...pattern,
      until: Temporal.PlainDate.from(task.startDate)
        .subtract({ days: 1 })
        .toString(),
    },
  });
});

function ids(rows: TaskSelect[]): string[] {
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
  input: TaskUpdateInput
) {
  const startDate = input.startDate ?? task.startDate;
  if (!startDate) {
    return yield* Effect.fail(
      new InvalidTaskError({
        message: "Task must have startDate to convert",
      })
    );
  }
  if (!input.recurrence) {
    return yield* Effect.fail(
      new InvalidTaskError({
        message: "Recurrence is required to convert",
      })
    );
  }

  // Generate occurrence dates (first one is the existing task's date)
  const seriesStartDate = Temporal.PlainDate.from(startDate);
  const occurrenceDates = generateOccurrences(
    input.recurrence,
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

/** Handle scope=following update for recurring task */
const updateFollowing = Effect.fn("updateFollowing")(function* (
  userId: string,
  task: TaskSelect,
  input: TaskUpdateInput,
  recurrenceChanged: boolean
) {
  // Without a start date there is no "following"; edit this occurrence alone.
  if (!isDatedSeriesTask(task)) {
    return allRetagged(
      yield* dbUpdate(userId, task.id, { ...input, isException: true })
    );
  }

  // If recurrence pattern is changing, regenerate future occurrences (inside
  // updateTask's transaction, like everything below).
  if (recurrenceChanged) {
    return yield* regenerateOccurrences(userId, task, input);
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
      if (!taskInput.startDate) {
        return yield* Effect.fail(
          new InvalidTaskError({
            message: "Recurring tasks require a startDate",
          })
        );
      }

      const taskRows = buildRecurringTaskRows(
        userId,
        taskInput,
        taskInput.recurrence,
        taskInput.startDate
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
      const dbInput = stripSystemManagedTaskFields(unsafeDbInput);
      const hasDbUpdates = Object.keys(dbInput).length > 0;
      const normalizedTagIds = yield* resolveTagIdsForUser(userId, tagIds);
      const changesPattern =
        task.seriesMasterId !== null &&
        (yield* changesSeriesRecurrence(userId, task, dbInput));
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
      const recurrenceChanged = changesPattern && scope === "following";

      // Regenerating a series replaces its rows. When the edit doesn't set
      // tags, read this task's tags now so the new rows can keep them.
      const carriedTagIds =
        normalizedTagIds === undefined && recurrenceChanged
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
            normalizedTagIds,
            recurrenceChanged,
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

      // Non-recurring or scope=this: delete single task
      if (!task.seriesMasterId || scope === "this") {
        yield* dbDelete(userId, taskId);
        return;
      }

      // scope=following: delete this task and all future tasks in series
      if (scope === "following" && task.startDate) {
        yield* dbDeleteBySeriesFrom(
          userId,
          task.seriesMasterId,
          task.startDate
        );
      }
    });

    return { createTask, deleteTask, getTask, listTasks, updateTask };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DatabaseLive)
  );
}
