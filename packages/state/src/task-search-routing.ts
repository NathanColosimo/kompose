import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";

export type TaskSearchSidebarView = "inbox" | "today";

export type TaskSearchDestination =
  | { kind: "calendar"; date: Temporal.PlainDate }
  | { date?: Temporal.PlainDate; kind: "sidebar"; view: TaskSearchSidebarView }
  | { kind: "unmapped"; reason: string };

export interface ResolveTaskSearchDestinationOptions {
  now: Temporal.ZonedDateTime;
  timeZone: string;
  today: Temporal.PlainDate;
}

export interface CommandBarTaskOpenRequest {
  date?: Temporal.PlainDate;
  requestId: string;
  sidebarView?: TaskSearchSidebarView;
  target: "calendar" | "sidebar";
  taskId: string;
}

export interface SerializedCommandBarTaskOpenRequest {
  date?: string;
  requestId: string;
  sidebarView?: TaskSearchSidebarView;
  target: "calendar" | "sidebar";
  taskId: string;
}

export function isTaskScheduledOnCalendar(task: TaskSelectDecoded): boolean {
  return task.startDate !== null && task.startTime !== null;
}

/**
 * Whether a task is listed on its own, outside the calendar: one that
 * doesn't repeat, or a series occurrence moved to the inbox alone. A
 * series' dated occurrences show on the calendar instead.
 */
export function isListedAlone(task: TaskSelectDecoded): boolean {
  return task.seriesMasterId === null || task.startDate === null;
}

/**
 * Inbox: open tasks with no date. That includes an occurrence of a series
 * moved there alone ("I'll do this one later"); a series' scheduled
 * occurrences always have a date. Leaving those out hid them everywhere.
 */
export function isInboxTask(task: TaskSelectDecoded): boolean {
  return task.status !== "done" && task.startDate === null;
}

/** Overdue: uncompleted tasks with past due date or past end time (start + duration). */
export function isOverdueTask(
  task: TaskSelectDecoded,
  today: Temporal.PlainDate,
  now: Temporal.ZonedDateTime,
  timeZone: string
): boolean {
  const hasPastDueDate =
    task.dueDate !== null &&
    Temporal.PlainDate.compare(task.dueDate, today) < 0;
  const hasPastStartTime =
    task.startDate !== null &&
    task.startTime !== null &&
    Temporal.ZonedDateTime.compare(
      task.startDate
        .toZonedDateTime({ plainTime: task.startTime, timeZone })
        .add({ minutes: task.durationMinutes }),
      now
    ) < 0;

  return task.status !== "done" && (hasPastDueDate || hasPastStartTime);
}

/**
 * Unplanned today: uncompleted tasks with a start date and no start time.
 * Recurring occurrences stay scoped to today so older untouched instances do not
 * accumulate in the Today view.
 */
export function isUnplannedTodayTask(
  task: TaskSelectDecoded,
  today: Temporal.PlainDate
): boolean {
  if (task.status === "done") {
    return false;
  }
  if (task.startDate === null || task.startTime !== null) {
    return false;
  }

  const startsOnOrBeforeToday =
    task.seriesMasterId === null
      ? Temporal.PlainDate.compare(task.startDate, today) <= 0
      : Temporal.PlainDate.compare(task.startDate, today) === 0;

  return (
    startsOnOrBeforeToday &&
    (task.dueDate === null ||
      Temporal.PlainDate.compare(task.dueDate, today) > 0)
  );
}

function isDatedUnplannedTask(task: TaskSelectDecoded): boolean {
  return (
    task.status !== "done" && task.startDate !== null && task.startTime === null
  );
}

/** Done on a date: completed tasks last updated on that local date. */
export function isDoneOnDate(
  task: TaskSelectDecoded,
  date: Temporal.PlainDate,
  timeZone: string
): boolean {
  return (
    task.status === "done" &&
    Temporal.PlainDate.compare(
      task.updatedAt.toZonedDateTimeISO(timeZone).toPlainDate(),
      date
    ) === 0
  );
}

export function resolveTaskSearchDestination(
  task: TaskSelectDecoded,
  { now, timeZone, today }: ResolveTaskSearchDestinationOptions
): TaskSearchDestination {
  if (isTaskScheduledOnCalendar(task) && task.startDate) {
    return {
      date: task.startDate,
      kind: "calendar",
    };
  }

  if (isInboxTask(task)) {
    return {
      kind: "sidebar",
      view: "inbox",
    };
  }

  if (isDatedUnplannedTask(task) && task.startDate) {
    return {
      date: task.startDate,
      kind: "sidebar",
      view: "today",
    };
  }

  if (
    isOverdueTask(task, today, now, timeZone) ||
    isUnplannedTodayTask(task, today) ||
    isDoneOnDate(task, today, timeZone)
  ) {
    return {
      kind: "sidebar",
      view: "today",
    };
  }

  return {
    kind: "unmapped",
    reason: "Task is searchable but not currently mounted in Inbox or Today.",
  };
}

export function createCommandBarTaskOpenRequest(args: {
  destination: Exclude<TaskSearchDestination, { kind: "unmapped" }>;
  taskId: string;
}): CommandBarTaskOpenRequest {
  if (args.destination.kind === "calendar") {
    return {
      date: args.destination.date,
      requestId: uuidv7(),
      target: "calendar",
      taskId: args.taskId,
    };
  }

  return {
    date: args.destination.date,
    requestId: uuidv7(),
    sidebarView: args.destination.view,
    target: "sidebar",
    taskId: args.taskId,
  };
}

export function serializeCommandBarTaskOpenRequest(
  request: CommandBarTaskOpenRequest
): SerializedCommandBarTaskOpenRequest {
  return {
    ...request,
    date: request.date?.toString(),
  };
}

export function deserializeCommandBarTaskOpenRequest(
  request: SerializedCommandBarTaskOpenRequest
): CommandBarTaskOpenRequest {
  return {
    ...request,
    date: request.date ? Temporal.PlainDate.from(request.date) : undefined,
  };
}
