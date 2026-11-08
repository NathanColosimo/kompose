import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import {
  nowZonedDateTimeAtom,
  timezoneAtom,
  todayPlainDateAtom,
} from "../atoms/current-date";
import {
  isDoneOnDate,
  isInboxTask,
  isOverdueTask,
  isUnplannedTodayTask,
} from "../task-search-routing";
import { useTasks } from "./use-tasks";

/** Recurring masters also carry seriesMasterId, so this excludes the whole series. */
export const isNonRecurring = (task: TaskSelectDecoded): boolean =>
  task.seriesMasterId === null;

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
    !isOverdueTask(task, today, nowZdt, timeZone)
  );
};

const isUnplannedOnDate = (
  task: TaskSelectDecoded,
  targetDate: Temporal.PlainDate
): boolean =>
  task.status !== "done" &&
  task.startDate !== null &&
  task.startTime === null &&
  Temporal.PlainDate.compare(task.startDate, targetDate) === 0;

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
          doneTasks: [],
          inboxTasks: [],
          overdueTasks: [],
          plannedTasks: [],
          unplannedTasks: [],
        };
      }

      // Inbox: uncompleted, no startDate (isInboxTask). This also catches
      // legacy rows with an orphaned startTime but no startDate.
      const inbox = tasks
        .filter(isInboxTask)
        .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

      // Date view sections. Overdue is only meaningful for real today.
      const isTargetToday = Temporal.PlainDate.compare(targetDate, today) === 0;
      const overdue = isTargetToday
        ? tasks.filter((task) => isOverdueTask(task, today, nowZdt, timeZone))
        : [];
      const planned = tasks.filter((task) =>
        isPlanned(task, targetDate, today, nowZdt, timeZone)
      );
      const unplanned = isTargetToday
        ? tasks.filter((task) => isUnplannedTodayTask(task, today))
        : tasks.filter((task) => isUnplannedOnDate(task, targetDate));
      const done = tasks.filter((task) =>
        isDoneOnDate(task, targetDate, timeZone)
      );

      return {
        doneTasks: done,
        inboxTasks: inbox,
        overdueTasks: overdue,
        plannedTasks: planned,
        unplannedTasks: unplanned,
      };
    }, [tasksQuery.data, timeZone, targetDate, today, nowZdt]);

  return {
    createTask,
    deleteTask,
    doneTasks,
    inboxTasks,
    overdueTasks,
    plannedTasks,
    tasksQuery,
    unplannedTasks,
    updateTask,
  };
}
