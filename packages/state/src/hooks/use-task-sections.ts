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

interface TaskSections {
  doneTasks: TaskSelectDecoded[];
  inboxTasks: TaskSelectDecoded[];
  overdueTasks: TaskSelectDecoded[];
  plannedTasks: TaskSelectDecoded[];
  unplannedTasks: TaskSelectDecoded[];
}

export function getTaskSections(
  tasks: readonly TaskSelectDecoded[],
  context: TaskPresentationContext
): TaskSections {
  const sections: TaskSections = {
    doneTasks: [],
    inboxTasks: [],
    overdueTasks: [],
    plannedTasks: [],
    unplannedTasks: [],
  };

  for (const task of tasks) {
    const { inbox, section } = deriveTaskPresentation(task, context);
    if (inbox) {
      sections.inboxTasks.push(task);
    }
    if (section !== null) {
      sections[`${section}Tasks`].push(task);
    }
  }
  sections.inboxTasks.sort((a, b) =>
    Temporal.Instant.compare(b.updatedAt, a.updatedAt)
  );
  return sections;
}

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
    useMemo(
      () =>
        getTaskSections(tasksQuery.data ?? [], {
          now: nowZdt,
          targetDate,
          timeZone,
          today,
        }),
      [tasksQuery.data, timeZone, targetDate, today, nowZdt]
    );

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
