import { sameRecurrence } from "@kompose/api/lib/recurrence";
import type {
  TaskSelectDecoded,
  TaskUpdateDecoded,
} from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { resolveTaskRecurrenceForEditor } from "./task-recurrence";

/**
 * The edit without a pattern its task's series already has. Editors may
 * send the pattern along unchanged; the server ignores it, so the cache
 * must too, comparing the same way the server does.
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
    !sameRecurrence(
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
 * The task list after a save the editor waited on: saved rows replace their
 * cached copies, and for a "this and following" save the edited occurrence's
 * series loses its non-exception rows from where the edit starts that the
 * server didn't return (a pattern change replaced them), and gains the new
 * ones. A pattern change splits the series at the earlier of the
 * occurrence's date and its new one, as the server does; any other edit
 * keeps the rows before the occurrence.
 * So the editor closes onto the result rather than waiting for the refetch.
 */
export function mergeSavedTasks(
  cached: TaskSelectDecoded[],
  saved: TaskSelectDecoded[],
  edit: {
    id: string;
    scope: "following" | "this";
    /** The fields the save sent. */
    task: TaskUpdateDecoded;
  }
): TaskSelectDecoded[] {
  const savedById = new Map(saved.map((task) => [task.id, task]));
  const edited = cached.find((task) => task.id === edit.id);
  const seriesId = edited?.seriesMasterId;
  const sent = withoutUnchangedPattern(cached, edit.id, edit.task);
  const splitDate = sent.recurrence === undefined ? null : sent.startDate;
  const from =
    splitDate &&
    edited?.startDate &&
    Temporal.PlainDate.compare(splitDate, edited.startDate) < 0
      ? splitDate
      : edited?.startDate;
  const replaced = (task: TaskSelectDecoded) =>
    edit.scope === "following" &&
    seriesId !== null &&
    seriesId !== undefined &&
    from !== null &&
    from !== undefined &&
    task.seriesMasterId === seriesId &&
    !task.isException &&
    task.startDate !== null &&
    Temporal.PlainDate.compare(task.startDate, from) >= 0 &&
    !savedById.has(task.id);
  const cachedIds = new Set(cached.map((task) => task.id));
  return [
    ...cached
      .filter((task) => !replaced(task))
      .map((task) => savedById.get(task.id) ?? task),
    ...saved.filter((task) => !cachedIds.has(task.id)),
  ];
}
