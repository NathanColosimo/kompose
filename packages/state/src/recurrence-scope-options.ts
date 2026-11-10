import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { RecurrenceScope } from "@kompose/google-cal/schema";

export interface RecurrenceScopeOption<TValue extends string = string> {
  label: string;
  value: TValue;
}

// Narrowest first, the same order everywhere.
export const RECURRENCE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<RecurrenceScope>[] =
  [
    { label: "Only this occurrence", value: "this" },
    { label: "This and following", value: "following" },
    { label: "Entire series", value: "all" },
  ] as const;

export const SCOPE_DIALOG_COPY = {
  deleteEvent: { description: "Delete:", title: "Delete recurring event" },
  deleteTask: { description: "Delete:", title: "Delete recurring task" },
  deleteTaskAlone: {
    description: "This can't be undone.",
    title: "Delete task?",
  },
  saveEvent: {
    description: "Apply your changes to:",
    title: "Save recurring event",
  },
  saveTask: {
    description: "Apply your changes to:",
    title: "Save recurring task",
  },
} as const;

// Task updates and deletes offer the same two scopes.
const TASK_SCOPE_OPTIONS = [
  { label: "Only this occurrence", value: "this" },
  { label: "This and following", value: "following" },
] as const;

export const TASK_UPDATE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<UpdateScope>[] =
  TASK_SCOPE_OPTIONS;

export const TASK_DELETE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<DeleteScope>[] =
  TASK_SCOPE_OPTIONS;

export interface EventSaveChanges {
  dateMoved: boolean;
  patternChanged: boolean;
  seriesRuleFailed?: boolean;
  seriesRuleLoaded: boolean;
}

/** Entire series keeps the series' date; one occurrence can't change its repeat. */
export function eventSaveDisabledScopes(
  changes: EventSaveChanges
): Partial<Record<RecurrenceScope, boolean>> {
  if (!changes.seriesRuleLoaded) {
    return { all: true, following: true, this: true };
  }
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(changes.dateMoved ? { all: true } : {}),
  };
}

export function eventSaveDescription(changes: EventSaveChanges): string {
  if (!changes.seriesRuleLoaded) {
    return changes.seriesRuleFailed
      ? "Couldn't load the series. Try again."
      : "Loading the series…";
  }
  if (changes.dateMoved) {
    return "Entire series keeps the series' date, so it can't apply a move to another day.";
  }
  if (changes.patternChanged) {
    return "A new repeat applies from this occurrence on, or to the entire series.";
  }
  return SCOPE_DIALOG_COPY.saveEvent.description;
}

export function chosenScope(
  pick: RecurrenceScope | null,
  preferred: RecurrenceScope,
  disabled: Partial<Record<RecurrenceScope, boolean>>
): RecurrenceScope {
  if (pick && !disabled[pick]) {
    return pick;
  }
  if (!disabled[preferred]) {
    return preferred;
  }
  // `preferred` when none is left: the dialog then says why and holds Save.
  return (
    RECURRENCE_SCOPE_OPTIONS.find((option) => !disabled[option.value])?.value ??
    preferred
  );
}
