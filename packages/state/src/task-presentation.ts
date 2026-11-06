import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";

export type TaskSearchSidebarView = "inbox" | "today";

export type TaskSearchDestination =
  | { kind: "calendar"; date: Temporal.PlainDate }
  | { date?: Temporal.PlainDate; kind: "sidebar"; view: TaskSearchSidebarView }
  | { kind: "unmapped"; reason: string };

export interface TaskPresentationContext {
  now: Temporal.ZonedDateTime;
  targetDate?: Temporal.PlainDate;
  timeZone: string;
  today: Temporal.PlainDate;
}

export interface TaskPresentation {
  destination: TaskSearchDestination;
  inbox: boolean;
  section: "planned" | "unplanned" | "overdue" | "done" | null;
}

function getSearchDestination(
  task: TaskSelectDecoded,
  {
    completedDate,
    inbox,
    overdue,
    today,
  }: {
    completedDate: Temporal.PlainDate | null;
    inbox: boolean;
    overdue: boolean;
    today: Temporal.PlainDate;
  }
): TaskSearchDestination {
  if (task.startDate && task.startTime) {
    return { date: task.startDate, kind: "calendar" };
  }
  if (inbox) {
    return { kind: "sidebar", view: "inbox" };
  }
  if (overdue || completedDate?.equals(today)) {
    // Sidebar "today" follows the selected date, so navigation must set it.
    return { date: today, kind: "sidebar", view: "today" };
  }
  if (task.status !== "done" && task.startDate && task.startTime === null) {
    return { date: task.startDate, kind: "sidebar", view: "today" };
  }
  return {
    kind: "unmapped",
    reason: "Task is searchable but not currently mounted in Inbox or Today.",
  };
}

/** Date-view membership and search routing share these rules; see documents/state.md. */
export function deriveTaskPresentation(
  task: TaskSelectDecoded,
  context: TaskPresentationContext
): TaskPresentation {
  const { now, timeZone, today } = context;
  const targetDate = context.targetDate ?? today;
  const done = task.status === "done";
  const scheduled = task.startDate !== null && task.startTime !== null;
  const inbox =
    !done && task.seriesMasterId === null && task.startDate === null;
  const overdue =
    !done &&
    ((task.dueDate !== null &&
      Temporal.PlainDate.compare(task.dueDate, today) < 0) ||
      (task.startDate !== null &&
        task.startTime !== null &&
        Temporal.ZonedDateTime.compare(
          task.startDate
            .toZonedDateTime({ plainTime: task.startTime, timeZone })
            .add({ minutes: task.durationMinutes }),
          now
        ) < 0));
  const completedDate = done
    ? task.updatedAt.toZonedDateTimeISO(timeZone).toPlainDate()
    : null;
  const isTargetToday = targetDate.equals(today);

  let section: TaskPresentation["section"] = null;
  if (done) {
    section = completedDate?.equals(targetDate) ? "done" : null;
  } else if (isTargetToday && overdue) {
    section = "overdue";
  } else if (task.startDate?.equals(targetDate)) {
    section = scheduled ? "planned" : "unplanned";
  } else if (
    isTargetToday &&
    task.seriesMasterId === null &&
    task.startDate !== null &&
    task.startTime === null &&
    Temporal.PlainDate.compare(task.startDate, today) < 0
  ) {
    section = "unplanned";
  }

  return {
    destination: getSearchDestination(task, {
      completedDate,
      inbox,
      overdue,
      today,
    }),
    inbox,
    section,
  };
}
