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
  dbUpdate,
  dbUpdateBySeries,
  dbUpdateBySeriesFrom,
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
function buildRecurringTaskRows(
  userId: string,
  input: TaskInsert,
  recurrence: TaskRecurrence,
  startDate: string
): TaskInsertRow[] {
  const masterId = uuidv7();
  const parsedStartDate = Temporal.PlainDate.from(startDate);
  const occurrenceDates = generateOccurrences(recurrence, parsedStartDate);

  return occurrenceDates.map((date, index) => {
    const id = index === 0 ? masterId : uuidv7();
    return {
      ...input,
      id,
      userId,
      startDate: date.toString(),
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
  const occurrenceDates = generateOccurrences(recurrence, startDate);

  return occurrenceDates.map((date, index) => {
    const id = index === 0 ? newMasterId : uuidv7();
    return {
      userId,
      title: input.title ?? task.title,
      description: input.description ?? task.description,
      status: input.status ?? task.status,
      dueDate: input.dueDate ?? task.dueDate,
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
      dueDate: input.dueDate ?? task.dueDate,
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
    if (input.recurrence !== undefined) {
      return yield* regenerateOccurrences(userId, task, input);
    }

    // No recurrence change: just update fields on this and following
    return yield* dbUpdateBySeriesFrom(
      userId,
      task.seriesMasterId,
      task.startDate,
      input
    );
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
    if (!task.seriesMasterId && input.recurrence) {
      return yield* convertToRecurring(userId, task, input);
    }

    // Non-recurring or scope=this: update single task
    if (!task.seriesMasterId || scope === "this") {
      return yield* dbUpdate(userId, taskId, { ...input, isException: true });
    }

    // scope=all: update all tasks in series
    if (scope === "all") {
      return yield* dbUpdateBySeries(userId, task.seriesMasterId, input);
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
