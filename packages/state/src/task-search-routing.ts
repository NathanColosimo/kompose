import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";

export type TaskSearchSidebarView = "inbox" | "today";

export type TaskSearchDestination =
  | { kind: "calendar"; date: Temporal.PlainDate }
  | { kind: "sidebar"; view: TaskSearchSidebarView }
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

function isInboxTask(task: TaskSelectDecoded): boolean {
  return task.status !== "done" && task.startDate === null && task.startTime === null;
}

function isOverdueTask(
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
        .toZonedDateTime({ timeZone, plainTime: task.startTime })
        .add({ minutes: task.durationMinutes }),
      now
    ) < 0;

  return task.status !== "done" && (hasPastDueDate || hasPastStartTime);
}

function isUnplannedTodayTask(
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
    (task.dueDate === null || Temporal.PlainDate.compare(task.dueDate, today) > 0)
  );
}

function isDoneTodayTask(
  task: TaskSelectDecoded,
  today: Temporal.PlainDate,
  timeZone: string
): boolean {
  return (
    task.status === "done" &&
    Temporal.PlainDate.compare(
      task.updatedAt.toZonedDateTimeISO(timeZone).toPlainDate(),
      today
    ) === 0
  );
}

export function resolveTaskSearchDestination(
  task: TaskSelectDecoded,
  { now, timeZone, today }: ResolveTaskSearchDestinationOptions
): TaskSearchDestination {
  if (isTaskScheduledOnCalendar(task) && task.startDate) {
    return {
      kind: "calendar",
      date: task.startDate,
    };
  }

  if (isInboxTask(task)) {
    return {
      kind: "sidebar",
      view: "inbox",
    };
  }

  if (
    isOverdueTask(task, today, now, timeZone) ||
    isUnplannedTodayTask(task, today) ||
    isDoneTodayTask(task, today, timeZone)
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
      requestId: uuidv7(),
      taskId: args.taskId,
      target: "calendar",
      date: args.destination.date,
    };
  }

  return {
    requestId: uuidv7(),
    taskId: args.taskId,
    target: "sidebar",
    sidebarView: args.destination.view,
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
