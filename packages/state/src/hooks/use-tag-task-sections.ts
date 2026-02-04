import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import { timezoneAtom } from "../atoms/current-date";
import { todayPlainDate } from "../temporal-utils";
import { useTasks } from "./use-tasks";

const isNonRecurring = (task: TaskSelectDecoded): boolean =>
  task.seriesMasterId === null;

const isTagged = (task: TaskSelectDecoded, tagId: string): boolean =>
  task.tags.some((tag) => tag.id === tagId);

const isOverdue = (
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
      task.startDate.toZonedDateTime({
        timeZone,
        plainTime: task.startTime,
      }),
      nowZdt
    ) < 0;

  return task.status !== "done" && (hasPastDueDate || hasPastStartTime);
};

const getOverdueAt = (
  task: TaskSelectDecoded,
  timeZone: string
): Temporal.ZonedDateTime | null => {
  // Sort overdue tasks by the earliest overdue moment (due date or start time).
  const candidates: Temporal.ZonedDateTime[] = [];

  if (task.dueDate) {
    candidates.push(
      task.dueDate.toZonedDateTime({
        timeZone,
        plainTime: Temporal.PlainTime.from("00:00"),
      })
    );
  }

  if (task.startDate && task.startTime) {
    candidates.push(
      task.startDate.toZonedDateTime({
        timeZone,
        plainTime: task.startTime,
      })
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((earliest, current) =>
    Temporal.ZonedDateTime.compare(current, earliest) < 0 ? current : earliest
  );
};

const compareNullablePlainDate = (
  a: Temporal.PlainDate | null,
  b: Temporal.PlainDate | null
): number => {
  // Nulls sort last so scheduled/due dates bubble to the top.
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return Temporal.PlainDate.compare(a, b);
};

export function useTagTaskSections(tagId: string | null) {
  const { tasksQuery, updateTask, deleteTask } = useTasks();
  const timeZone = useAtomValue(timezoneAtom);

  const today = useMemo(() => todayPlainDate(timeZone), [timeZone]);
  const nowZdt = useMemo(
    () => Temporal.Now.zonedDateTimeISO(timeZone),
    [timeZone]
  );

  const { overdueTasks, todoTasks, doneTasks } = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    if (!tagId || tasks.length === 0) {
      return { overdueTasks: [], todoTasks: [], doneTasks: [] };
    }

    const taggedTasks = tasks.filter(
      (task) => isNonRecurring(task) && isTagged(task, tagId)
    );

    const overdue = taggedTasks
      .filter((task) => isOverdue(task, today, nowZdt, timeZone))
      .sort((a, b) => {
        const aOverdue = getOverdueAt(a, timeZone);
        const bOverdue = getOverdueAt(b, timeZone);
        if (aOverdue && bOverdue) {
          return Temporal.ZonedDateTime.compare(aOverdue, bOverdue);
        }
        if (aOverdue) {
          return -1;
        }
        if (bOverdue) {
          return 1;
        }
        return 0;
      });

    const todo = taggedTasks
      .filter(
        (task) =>
          task.status !== "done" && !isOverdue(task, today, nowZdt, timeZone)
      )
      .sort((a, b) => {
        const dueCompare = compareNullablePlainDate(a.dueDate, b.dueDate);
        if (dueCompare !== 0) {
          return dueCompare;
        }
        const startCompare = compareNullablePlainDate(a.startDate, b.startDate);
        if (startCompare !== 0) {
          return startCompare;
        }
        return Temporal.Instant.compare(b.updatedAt, a.updatedAt);
      });

    const done = taggedTasks
      .filter((task) => task.status === "done")
      .sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

    return { overdueTasks: overdue, todoTasks: todo, doneTasks: done };
  }, [nowZdt, tagId, tasksQuery.data, timeZone, today]);

  return {
    tasksQuery,
    updateTask,
    deleteTask,
    overdueTasks,
    todoTasks,
    doneTasks,
  };
}
