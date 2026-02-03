import type {
  TaskInsert,
  TaskRecurrence,
  TaskSelect,
  TaskUpdate,
} from "@kompose/db/schema/task";
import { Context, Data, Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";
import { generateOccurrences } from "../../lib/recurrence";
import type { DeleteScope, UpdateScope } from "./contract";
import {
  dbDelete,
  dbDeleteBySeriesFrom,
  dbDeleteNonExceptionsBySeriesFrom,
  dbInsert,
  dbSelect,
  dbSelectById,
  dbSelectBySeries,
  dbSelectBySeriesFrom,
  dbUpdate,
  dbUpdateBySeries,
  type TaskInsertRow,
} from "./db";

// Error types
export class TaskRepositoryError extends Data.TaggedError(
  "TaskRepositoryError"
)<{
  cause: unknown;
  message?: string;
}> {}

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  taskId: string;
}> {}

export class InvalidTaskError extends Data.TaggedError("InvalidTaskError")<{
  message: string;
}> {}

type TaskError = TaskRepositoryError | TaskNotFoundError | InvalidTaskError;

// ============================================================================
// Business logic helpers
// ============================================================================

/** Build task rows for a recurring series */
function getDueDateForOccurrence(params: {
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

/** Compare recurrence objects (undefined treated as null). */
function isSameRecurrence(
  a: TaskRecurrence | null | undefined,
  b: TaskRecurrence | null | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Remove per-occurrence fields when updating a series in bulk. */
function buildSeriesUpdateBase(input: TaskUpdate): TaskUpdate {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        value !== undefined &&
        key !== "startDate" &&
        key !== "dueDate" &&
        key !== "startTime" &&
        key !== "recurrence"
    )
  ) as TaskUpdate;
}

/** Parse a date string into Temporal.PlainDate (or null). */
function parsePlainDate(
  value: string | null | undefined
): Temporal.PlainDate | null {
  return value ? Temporal.PlainDate.from(value) : null;
}

/** Parse a time string into Temporal.PlainTime (or null). */
function parsePlainTime(
  value: string | null | undefined
): Temporal.PlainTime | null {
  return value ? Temporal.PlainTime.from(value) : null;
}

/** Resolve the next date value using input presence rules. */
function getNextPlainDate(
  hasValue: boolean,
  value: string | null | undefined,
  fallback: Temporal.PlainDate | null
): Temporal.PlainDate | null {
  if (!hasValue) {
    return fallback;
  }

  return parsePlainDate(value);
}

/** Resolve the next time value using input presence rules. */
function getNextPlainTime(
  hasValue: boolean,
  value: string | null | undefined,
  fallback: Temporal.PlainTime | null
): Temporal.PlainTime | null {
  if (!hasValue) {
    return fallback;
  }

  return parsePlainTime(value);
}

interface DueDateScaleBase {
  baseStartDate: Temporal.PlainDate;
  baseDueDate: Temporal.PlainDate | null;
}

interface DateScaleContext {
  baseStartDate: Temporal.PlainDate | null;
  baseDueDate: Temporal.PlainDate | null;
  nextStartDate: Temporal.PlainDate | null;
  nextDueDate: Temporal.PlainDate | null;
  startDateChanged: boolean;
  dueDateChanged: boolean;
  startDateDelta: Temporal.Duration | null;
  shouldClearDueDate: boolean;
  dueDateScaleBase: DueDateScaleBase | null;
}

interface TimeScaleContext {
  baseStartTime: Temporal.PlainTime | null;
  nextStartTime: Temporal.PlainTime | null;
  startTimeChanged: boolean;
  startTimeMode: "none" | "clear" | "set" | "shift";
  startTimeDelta: Temporal.Duration | null;
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

  const nextStartDate = getNextPlainDate(
    hasStartDate,
    input.startDate,
    baseStartDate
  );
  const nextDueDate = getNextPlainDate(hasDueDate, input.dueDate, baseDueDate);

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
        baseStartDate: nextStartDate,
        baseDueDate: nextDueDate,
      };
    } else if (baseStartDate && nextDueDate) {
      dueDateScaleBase = {
        baseStartDate,
        baseDueDate: nextDueDate,
      };
    }
  } else if (startDateChanged && baseStartDate && baseDueDate) {
    dueDateScaleBase = { baseStartDate, baseDueDate };
  }

  return {
    baseStartDate,
    baseDueDate,
    nextStartDate,
    nextDueDate,
    startDateChanged,
    dueDateChanged,
    startDateDelta,
    shouldClearDueDate,
    dueDateScaleBase,
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
  const nextStartTime = getNextPlainTime(
    hasStartTime,
    input.startTime,
    baseStartTime
  );

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
    startTimeMode,
    startTimeDelta,
  };
}

interface SeriesOccurrenceUpdateParams {
  seriesTask: TaskSelect;
  baseUpdate: TaskUpdate;
  dateContext: DateScaleContext;
  timeContext: TimeScaleContext;
  inputStartTime: string | null | undefined;
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
      baseStartDate: params.dateContext.dueDateScaleBase.baseStartDate,
      baseDueDate: params.dateContext.dueDateScaleBase.baseDueDate,
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

/** Decide if a series update needs date/time scaling. */
function shouldScaleSeriesDates(task: TaskSelect, input: TaskUpdate): boolean {
  const startDateChanged =
    input.startDate !== undefined && input.startDate !== task.startDate;
  const dueDateChanged =
    input.dueDate !== undefined && input.dueDate !== task.dueDate;
  const startTimeChanged =
    input.startTime !== undefined && input.startTime !== task.startTime;

  return startDateChanged || dueDateChanged || startTimeChanged;
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
      id,
      userId,
      startDate: date.toString(),
      // Keep the due date offset aligned with each occurrence's start date.
      dueDate: getDueDateForOccurrence({
        baseStartDate: parsedStartDate,
        baseDueDate: parsedDueDate,
        occurrenceDate: date,
      }),
      seriesMasterId: masterId,
      recurrence: index === 0 ? recurrence : null,
      isException: false,
    };
  });
}

/** Build task rows for regenerating a series with new recurrence */
function buildRegeneratedTaskRows(
  userId: string,
  task: TaskSelect,
  input: TaskUpdate,
  recurrence: TaskRecurrence,
  taskStartDate: string
): TaskInsertRow[] {
  const newMasterId = uuidv7();
  const startDate = Temporal.PlainDate.from(taskStartDate);
  const dueDate = input.dueDate ?? task.dueDate;
  const parsedDueDate = dueDate ? Temporal.PlainDate.from(dueDate) : null;
  const occurrenceDates = generateOccurrences(recurrence, startDate);

  return occurrenceDates.map((date, index) => {
    const id = index === 0 ? newMasterId : uuidv7();
    return {
      userId,
      title: input.title ?? task.title,
      description: input.description ?? task.description,
      status: input.status ?? task.status,
      dueDate: getDueDateForOccurrence({
        baseStartDate: startDate,
        baseDueDate: parsedDueDate,
        occurrenceDate: date,
      }),
      startDate: date.toString(),
      startTime: input.startTime ?? task.startTime,
      durationMinutes: input.durationMinutes ?? task.durationMinutes,
      id,
      seriesMasterId: newMasterId,
      recurrence: index === 0 ? recurrence : null,
      isException: false,
    };
  });
}

/** Regenerate occurrences with a new recurrence pattern */
const regenerateOccurrences = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdate
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    if (!task.startDate) {
      return yield* Effect.fail(
        new InvalidTaskError({
          message: "Task must have startDate to regenerate occurrences",
        })
      );
    }

    // Delete future non-exception tasks from this date onward
    if (task.seriesMasterId) {
      yield* dbDeleteNonExceptionsBySeriesFrom(
        userId,
        task.seriesMasterId,
        task.startDate
      );
    }

    // If recurrence is being removed, we're done
    if (!input.recurrence) {
      return [];
    }

    // Generate and insert new occurrences
    const taskRows = buildRegeneratedTaskRows(
      userId,
      task,
      input,
      input.recurrence,
      task.startDate
    );
    return yield* dbInsert(taskRows);
  });

/** Update a recurring series by scaling date/time offsets across occurrences. */
const updateSeriesWithScaledDates = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdate,
  scope: "all" | "following"
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    if (!task.seriesMasterId) {
      return yield* dbUpdate(userId, task.id, input);
    }

    // Pull the target occurrences for the requested scope.
    let seriesTasks: TaskSelect[];
    if (scope === "following" && task.startDate) {
      seriesTasks = yield* dbSelectBySeriesFrom(
        userId,
        task.seriesMasterId,
        task.startDate
      );
    } else {
      seriesTasks = yield* dbSelectBySeries(userId, task.seriesMasterId);
    }

    // Build a base update object (exclude per-occurrence date/time fields).
    const baseUpdate = buildSeriesUpdateBase(input);

    // Compute date/time scaling rules based on the edited occurrence.
    const dateContext = getDateScaleContext(task, input);
    const timeContext = getTimeScaleContext(task, input);

    const updatedTasks: TaskSelect[] = [];

    for (const seriesTask of seriesTasks) {
      const update = buildSeriesOccurrenceUpdate({
        seriesTask,
        baseUpdate,
        dateContext,
        timeContext,
        inputStartTime: input.startTime,
      });

      // Avoid issuing a no-op update.
      if (Object.keys(update).length === 0) {
        updatedTasks.push(seriesTask);
        continue;
      }

      const updated = yield* dbUpdate(userId, seriesTask.id, update);
      updatedTasks.push(...updated);
    }

    return updatedTasks;
  });

// ============================================================================
// Service Definition
// ============================================================================

export interface TaskService {
  readonly listTasks: (
    userId: string
  ) => Effect.Effect<TaskSelect[], TaskError>;
  readonly createTask: (
    userId: string,
    input: TaskInsert
  ) => Effect.Effect<TaskSelect[], TaskError>;
  readonly updateTask: (
    userId: string,
    taskId: string,
    input: TaskUpdate,
    scope: UpdateScope
  ) => Effect.Effect<TaskSelect[], TaskError>;
  readonly deleteTask: (
    userId: string,
    taskId: string,
    scope: DeleteScope
  ) => Effect.Effect<void, TaskError>;
}

export class Tasks extends Context.Tag("Tasks")<Tasks, TaskService>() {}

// ============================================================================
// Service Implementation
// ============================================================================

const listTasks = (userId: string): Effect.Effect<TaskSelect[], TaskError> =>
  dbSelect(userId);

const createTask = (
  userId: string,
  input: TaskInsert
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    // Non-recurring task: simple insert
    if (!input.recurrence) {
      const masterId = uuidv7();
      return yield* dbInsert([{ ...input, id: masterId, userId }]);
    }

    // Recurring task: validate and generate occurrences
    if (!input.startDate) {
      return yield* Effect.fail(
        new InvalidTaskError({ message: "Recurring tasks require a startDate" })
      );
    }

    const taskRows = buildRecurringTaskRows(
      userId,
      input,
      input.recurrence,
      input.startDate
    );
    return yield* dbInsert(taskRows);
  });

/** Convert a non-recurring task to a recurring series */
const convertToRecurring = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdate
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    const startDate = input.startDate ?? task.startDate;
    if (!startDate) {
      return yield* Effect.fail(
        new InvalidTaskError({ message: "Task must have startDate to convert" })
      );
    }
    if (!input.recurrence) {
      return yield* Effect.fail(
        new InvalidTaskError({ message: "Recurrence is required to convert" })
      );
    }

    // Generate occurrence dates (first one is the existing task's date)
    const parsedStartDate = Temporal.PlainDate.from(startDate);
    const dueDate = input.dueDate ?? task.dueDate;
    const parsedDueDate = dueDate ? Temporal.PlainDate.from(dueDate) : null;
    const occurrenceDates = generateOccurrences(
      input.recurrence,
      parsedStartDate
    );

    // Update the existing task to be the master
    const updatedMaster = yield* dbUpdate(userId, task.id, {
      ...input,
      seriesMasterId: task.id,
      isException: false,
    });

    // If only one occurrence (the master), we're done
    if (occurrenceDates.length <= 1) {
      return updatedMaster;
    }

    // Build additional occurrence rows (skip first since that's the master)
    const additionalRows = occurrenceDates.slice(1).map((date) => ({
      userId,
      title: input.title ?? task.title,
      description: input.description ?? task.description,
      status: input.status ?? task.status,
      // Keep the due date offset aligned with each occurrence's start date.
      dueDate: getDueDateForOccurrence({
        baseStartDate: parsedStartDate,
        baseDueDate: parsedDueDate,
        occurrenceDate: date,
      }),
      startDate: date.toString(),
      startTime: input.startTime ?? task.startTime,
      durationMinutes: input.durationMinutes ?? task.durationMinutes,
      id: uuidv7(),
      seriesMasterId: task.id, // Points to the original task as master
      recurrence: null, // Only master stores recurrence
      isException: false,
    }));

    const insertedOccurrences = yield* dbInsert(additionalRows);
    return [...updatedMaster, ...insertedOccurrences];
  });

/** Handle scope=following update for recurring task */
const updateFollowing = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdate
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    // Guard: need both startDate and seriesMasterId for series update
    if (!task.startDate) {
      return yield* dbUpdate(userId, task.id, { ...input, isException: true });
    }
    if (!task.seriesMasterId) {
      return yield* dbUpdate(userId, task.id, { ...input, isException: true });
    }

    // If recurrence pattern is changing, regenerate future occurrences
    const recurrenceChanged =
      input.recurrence !== undefined &&
      !isSameRecurrence(input.recurrence, task.recurrence);
    if (recurrenceChanged) {
      return yield* regenerateOccurrences(userId, task, input);
    }

    // No recurrence change: update this and following with scaled date/time offsets.
    return yield* updateSeriesWithScaledDates(userId, task, input, "following");
  });

/** Handle scope=all update for recurring task */
const updateAll = (
  userId: string,
  task: TaskSelect,
  input: TaskUpdate
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    if (!task.seriesMasterId) {
      return yield* dbUpdate(userId, task.id, { ...input, isException: true });
    }

    const seriesMasterId = task.seriesMasterId;

    const recurrenceChanged =
      input.recurrence !== undefined &&
      !isSameRecurrence(input.recurrence, task.recurrence);
    if (recurrenceChanged) {
      return yield* dbUpdateBySeries(userId, seriesMasterId, input);
    }

    if (shouldScaleSeriesDates(task, input)) {
      return yield* updateSeriesWithScaledDates(userId, task, input, "all");
    }

    const baseUpdate = buildSeriesUpdateBase(input);
    if (Object.keys(baseUpdate).length === 0) {
      return yield* dbSelectBySeries(userId, seriesMasterId);
    }

    return yield* dbUpdateBySeries(userId, seriesMasterId, baseUpdate);
  });

const updateTask = (
  userId: string,
  taskId: string,
  input: TaskUpdate,
  scope: UpdateScope
): Effect.Effect<TaskSelect[], TaskError> =>
  Effect.gen(function* () {
    // Get the task to check if it's recurring
    const tasks = yield* dbSelectById(userId, taskId);
    const task = tasks[0];

    if (!task) {
      return yield* Effect.fail(new TaskNotFoundError({ taskId }));
    }

    // Special case: non-recurring task becoming recurring
    if (!task.seriesMasterId) {
      if (input.recurrence) {
        return yield* convertToRecurring(userId, task, input);
      }
      return yield* dbUpdate(userId, taskId, { ...input, isException: true });
    }

    // Non-recurring or scope=this: update single task
    if (scope === "this") {
      return yield* dbUpdate(userId, taskId, { ...input, isException: true });
    }

    // scope=all: update all tasks in series
    if (scope === "all") {
      return yield* updateAll(userId, task, input);
    }

    // scope=following: update this task and all future tasks in series
    if (scope === "following") {
      return yield* updateFollowing(userId, task, input);
    }

    // Fallback: update single task
    return yield* dbUpdate(userId, taskId, { ...input, isException: true });
  });

const deleteTask = (
  userId: string,
  taskId: string,
  scope: DeleteScope
): Effect.Effect<void, TaskError> =>
  Effect.gen(function* () {
    // Get the task to check if it's recurring
    const tasks = yield* dbSelectById(userId, taskId);
    const task = tasks[0];

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
      yield* dbDeleteBySeriesFrom(userId, task.seriesMasterId, task.startDate);
      return;
    }
  });

// ============================================================================
// Service Layer
// ============================================================================

const taskService: TaskService = {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
};

export const TasksLive = Layer.succeed(Tasks, taskService);
