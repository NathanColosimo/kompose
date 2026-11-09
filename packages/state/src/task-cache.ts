import type {
  TaskSelectDecoded,
  TaskUpdateDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import {
  resolveTaskRecurrenceForEditor,
  taskRecurrenceEquals,
} from "./task-recurrence";

/**
 * The edit without a pattern its task's series already has. Editors may
 * send the pattern along unchanged; the server ignores it, so the cache
 * must too.
 */
export function withoutUnchangedPattern(
  cached: TaskSelectDecoded[],
  id: string,
  task: TaskUpdateDecoded
): TaskUpdateDecoded {
  const edited = cached.find((cachedTask) => cachedTask.id === id);
  if (
    task.recurrence === undefined ||
    !edited ||
    !taskRecurrenceEquals(
      task.recurrence,
      resolveTaskRecurrenceForEditor(edited, cached)
    )
  ) {
    return task;
  }
  const { recurrence: _unchanged, ...edit } = task;
  return edit;
}

/**
 * The task list after a save the editor waited on, so the editor closes onto
 * the result rather than waiting for the refetch. Saved rows replace their
 * cached copies, and new ones join. A "this and following" pattern change
 * also replaces the series' non-exception rows from where the edit starts
 * (the earlier of the occurrence's date and its new one, as the server
 * splits it): those the server didn't return are gone. Any other save
 * removes nothing; the server returns every row it changed.
 */
export function mergeSavedTasks(
  cached: TaskSelectDecoded[],
  saved: TaskSelectDecoded[],
  edit: {
    id: string;
    scope: UpdateScope;
    /** The fields the save sent. */
    task: TaskUpdateDecoded;
  }
): TaskSelectDecoded[] {
  const savedById = new Map(saved.map((task) => [task.id, task]));
  const cachedIds = new Set(cached.map((task) => task.id));
  const merged = [
    ...cached.map((task) => savedById.get(task.id) ?? task),
    ...saved.filter((task) => !cachedIds.has(task.id)),
  ];
  const edited = cached.find((task) => task.id === edit.id);
  const sent = withoutUnchangedPattern(cached, edit.id, edit.task);
  if (
    edit.scope !== "following" ||
    sent.recurrence === undefined ||
    !edited?.seriesMasterId ||
    !edited.startDate
  ) {
    return merged;
  }
  const seriesId = edited.seriesMasterId;
  const from =
    sent.startDate &&
    Temporal.PlainDate.compare(sent.startDate, edited.startDate) < 0
      ? sent.startDate
      : edited.startDate;
  return merged.filter(
    (task) =>
      savedById.has(task.id) ||
      task.seriesMasterId !== seriesId ||
      task.isException ||
      task.startDate === null ||
      Temporal.PlainDate.compare(task.startDate, from) < 0
  );
}
