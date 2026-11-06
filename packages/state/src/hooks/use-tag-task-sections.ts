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
  deriveTaskPresentation,
  type TaskPresentationContext,
} from "../task-presentation";
import { useTasks } from "./use-tasks";

const isTagged = (task: TaskSelectDecoded, tagId: string): boolean =>
  task.tags.some((tag) => tag.id === tagId);

const getOverdueAt = (
  task: TaskSelectDecoded,
  timeZone: string
): Temporal.ZonedDateTime | null => {
  // Sort overdue tasks by the earliest overdue moment (due date or start time).
  const candidates: Temporal.ZonedDateTime[] = [];

  if (task.dueDate) {
    candidates.push(
      task.dueDate.toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone,
      })
    );
  }

  if (task.startDate && task.startTime) {
    candidates.push(
      task.startDate.toZonedDateTime({
        plainTime: task.startTime,
        timeZone,
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

export function getTagTaskSections(
  tasks: readonly TaskSelectDecoded[],
  tagId: string | null,
  context: TaskPresentationContext
) {
  const overdue: {
    at: Temporal.ZonedDateTime | null;
    task: TaskSelectDecoded;
  }[] = [];
  const todoTasks: TaskSelectDecoded[] = [];
  const doneTasks: TaskSelectDecoded[] = [];
  if (!tagId) {
    return { doneTasks, overdueTasks: [], todoTasks };
  }

  // Tags show all dates, so overdue membership is always evaluated for today.
  const todayContext = { ...context, targetDate: context.today };
  for (const task of tasks) {
    if (task.seriesMasterId !== null || !isTagged(task, tagId)) {
      continue;
    }
    const { section } = deriveTaskPresentation(task, todayContext);
    if (task.status === "done") {
      doneTasks.push(task);
    } else if (section === "overdue") {
      overdue.push({ at: getOverdueAt(task, context.timeZone), task });
    } else {
      todoTasks.push(task);
    }
  }

  overdue.sort((a, b) => {
    if (a.at && b.at) {
      return Temporal.ZonedDateTime.compare(a.at, b.at);
    }
    if (a.at) {
      return -1;
    }
    if (b.at) {
      return 1;
    }
    return 0;
  });
  todoTasks.sort((a, b) => {
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
  doneTasks.sort((a, b) => Temporal.Instant.compare(b.updatedAt, a.updatedAt));

  return {
    doneTasks,
    overdueTasks: overdue.map(({ task }) => task),
    todoTasks,
  };
}

export function useTagTaskSections(tagId: string | null) {
  const { tasksQuery } = useTasks();
  const timeZone = useAtomValue(timezoneAtom);
  const today = useAtomValue(todayPlainDateAtom);
  const nowZdt = useAtomValue(nowZonedDateTimeAtom);

  return useMemo(
    () =>
      getTagTaskSections(tasksQuery.data ?? [], tagId, {
        now: nowZdt,
        timeZone,
        today,
      }),
    [nowZdt, tagId, tasksQuery.data, timeZone, today]
  );
}
