import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import { timezoneAtom } from "../atoms/current-date";
import { todayPlainDate } from "../temporal-utils";
import { useTasks } from "./use-tasks";

/** Filter out recurring tasks (both masters and occurrences). */
export const isNonRecurring = (task: TaskSelectDecoded): boolean =>
  task.seriesMasterId === null;

/** Inbox: uncompleted tasks with no startDate/startTime. */
const isInboxTask = (task: TaskSelectDecoded): boolean =>
  task.status !== "done" && task.startDate === null && task.startTime === null;

/** Overdue: uncompleted tasks with past due date or past end time (start + duration). */
export const isOverdue = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate,
  nowZdt: Temporal.ZonedDateTime,
  timeZone: string
): boolean => {
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
      nowZdt
    ) < 0;

  return task.status !== "done" && (hasPastDueDate || hasPastStartTime);
};

/** Planned: scheduled on today's calendar (has startDate=today + startTime) and not overdue. */
const isPlanned = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate,
  nowZdt: Temporal.ZonedDateTime,
  timeZone: string
): boolean =>
  task.status !== "done" &&
  task.startDate !== null &&
  task.startTime !== null &&
  Temporal.PlainDate.compare(task.startDate, today) === 0 &&
  !isOverdue(task, today, nowZdt, timeZone);

/** Unplanned: past/today startDate, no startTime, due date in future (or null). */
const isUnplanned = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate
): boolean =>
  task.startDate !== null &&
  task.startTime === null &&
  Temporal.PlainDate.compare(task.startDate, today) <= 0 &&
  (task.dueDate === null ||
    Temporal.PlainDate.compare(task.dueDate, today) > 0);

/** Done today: completed tasks updated on today's local date. */
const isDoneToday = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate,
  timeZone: string
): boolean =>
  task.status === "done" &&
  Temporal.PlainDate.compare(
    task.updatedAt.toZonedDateTimeISO(timeZone).toPlainDate(),
    today
  ) === 0;

/**
 * Shared task sections to keep Inbox/Today parity across web and native.
 */
export function useTaskSections() {
  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const timeZone = useAtomValue(timezoneAtom);

  // Cache "today" and "now" per timezone to keep comparisons consistent.
  const today = useMemo(() => todayPlainDate(timeZone), [timeZone]);
  const nowZdt = useMemo(
    () => Temporal.Now.zonedDateTimeISO(timeZone),
    [timeZone]
  );

  const { inboxTasks, overdueTasks, plannedTasks, unplannedTasks, doneTasks } =
    useMemo(() => {
      const tasks = tasksQuery.data ?? [];
      if (tasks.length === 0) {
        return {
          inboxTasks: [],
          overdueTasks: [],
          plannedTasks: [],
          unplannedTasks: [],
          doneTasks: [],
        };
      }

      // Base filter: exclude recurring tasks to match sidebar behavior.
      const nonRecurring = tasks.filter(isNonRecurring);

      // Inbox: uncompleted, no startDate/startTime, sorted by updatedAt desc.
      const inbox = nonRecurring
        .filter(isInboxTask)
        .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

      // Today view sections.
      const overdue = tasks.filter(
        (task) =>
          task.status !== "done" && isOverdue(task, today, nowZdt, timeZone)
      );
      const planned = nonRecurring.filter((task) =>
        isPlanned(task, today, nowZdt, timeZone)
      );
      const unplanned = nonRecurring.filter(
        (task) => task.status !== "done" && isUnplanned(task, today)
      );
      // Done: completed today in the user's timezone.
      const done = tasks.filter((task) => isDoneToday(task, today, timeZone));

      return {
        inboxTasks: inbox,
        overdueTasks: overdue,
        plannedTasks: planned,
        unplannedTasks: unplanned,
        doneTasks: done,
      };
    }, [tasksQuery.data, timeZone, today, nowZdt]);

  return {
    tasksQuery,
    createTask,
    updateTask,
    deleteTask,
    inboxTasks,
    overdueTasks,
    plannedTasks,
    unplannedTasks,
    doneTasks,
  };
}
