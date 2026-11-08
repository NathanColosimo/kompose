import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";

/**
 * The task list after a save the editor waited on: saved rows replace their
 * cached copies, and for a "this and following" save the edited occurrence's
 * series loses its non-exception rows from where the edit starts (the
 * earlier of the occurrence's date and its new one, as the server splits
 * the series) that the server didn't return (a pattern change replaced
 * them), and gains the new ones.
 * So the editor closes onto the result rather than waiting for the refetch.
 */
export function mergeSavedTasks(
  cached: TaskSelectDecoded[],
  saved: TaskSelectDecoded[],
  edit: {
    id: string;
    scope: "following" | "this";
    /** The edit's new start date, when it moves the occurrence. */
    startDate?: Temporal.PlainDate | null;
  }
): TaskSelectDecoded[] {
  const savedById = new Map(saved.map((task) => [task.id, task]));
  const edited = cached.find((task) => task.id === edit.id);
  const seriesId = edited?.seriesMasterId;
  const from =
    edit.startDate &&
    edited?.startDate &&
    Temporal.PlainDate.compare(edit.startDate, edited.startDate) < 0
      ? edit.startDate
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
