import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  nowZonedDateTimeAtom,
  timezoneAtom,
  todayPlainDateAtom,
} from "../atoms/current-date";
import { isInboxTask } from "../task-search-routing";
import { useTasks } from "./use-tasks";

/** Filter out recurring tasks (both masters and occurrences). */
export const isNonRecurring = (task: TaskSelectDecoded): boolean =>
  task.seriesMasterId === null;

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

/** Planned: scheduled on the target calendar date. Today excludes overdue tasks. */
const isPlanned = (
  task: TaskSelectDecoded,
  targetDate: Temporal.PlainDate,
  today: Temporal.PlainDate,
  nowZdt: Temporal.ZonedDateTime,
  timeZone: string
): boolean => {
  if (
    task.status === "done" ||
    task.startDate === null ||
    task.startTime === null ||
    Temporal.PlainDate.compare(task.startDate, targetDate) !== 0
  ) {
    return false;
  }

  return (
    Temporal.PlainDate.compare(targetDate, today) !== 0 ||
    !isOverdue(task, today, nowZdt, timeZone)
  );
};

/**
 * Unplanned: unscheduled tasks with a start date and no start time.
 * Recurring occurrences stay scoped to today so older untouched instances do not
 * accumulate in the Today view.
 */
const isUnplanned = (
  task: TaskSelectDecoded,
  today: Temporal.PlainDate
): boolean => {
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
};

/** Unplanned on a specific non-today date. */
const isUnplannedOnDate = (
  task: TaskSelectDecoded,
  targetDate: Temporal.PlainDate
): boolean =>
  task.status !== "done" &&
  task.startDate !== null &&
  task.startTime === null &&
  Temporal.PlainDate.compare(task.startDate, targetDate) === 0;

/** Done on target date: completed tasks updated on that local date. */
const isDoneOnDate = (
  task: TaskSelectDecoded,
  targetDate: Temporal.PlainDate,
  timeZone: string
): boolean =>
  task.status === "done" &&
  Temporal.PlainDate.compare(
    task.updatedAt.toZonedDateTimeISO(timeZone).toPlainDate(),
    targetDate
  ) === 0;

interface UseTaskSectionsOptions {
  targetDate?: Temporal.PlainDate;
}

/**
 * Shared task sections to keep Inbox/Today parity across web and native.
 */
export function useTaskSections(options: UseTaskSectionsOptions = {}) {
  const { tasksQuery, createTask, updateTask, deleteTask } = useTasks();
  const timeZone = useAtomValue(timezoneAtom);
  const today = useAtomValue(todayPlainDateAtom);
  const targetDate = options.targetDate ?? today;
  const nowZdt = useAtomValue(nowZonedDateTimeAtom);

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

      // Inbox: uncompleted, non-recurring, no startDate. This also catches
      // legacy rows with an orphaned startTime but no startDate.
      const inbox = tasks
        .filter(isInboxTask)
        .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

      // Date view sections. Overdue is only meaningful for real today.
      const isTargetToday = Temporal.PlainDate.compare(targetDate, today) === 0;
      const overdue = isTargetToday
        ? tasks.filter(
            (task) =>
              task.status !== "done" && isOverdue(task, today, nowZdt, timeZone)
          )
        : [];
      const planned = tasks.filter((task) =>
        isPlanned(task, targetDate, today, nowZdt, timeZone)
      );
      const unplanned = isTargetToday
        ? tasks.filter(
            (task) => task.status !== "done" && isUnplanned(task, today)
          )
        : tasks.filter((task) => isUnplannedOnDate(task, targetDate));
      // Done: completed on the target date in the user's timezone.
      const done = tasks.filter((task) =>
        isDoneOnDate(task, targetDate, timeZone)
      );

      return {
        inboxTasks: inbox,
        overdueTasks: overdue,
        plannedTasks: planned,
        unplannedTasks: unplanned,
        doneTasks: done,
      };
    }, [tasksQuery.data, timeZone, targetDate, today, nowZdt]);

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
