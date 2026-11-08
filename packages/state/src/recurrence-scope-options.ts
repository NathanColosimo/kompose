import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { RecurrenceScope } from "@kompose/google-cal/schema";
import { timeZoneCity } from "./google-event-recurrence";

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

/** The scope dialogs' words, shared by web and iOS. */
export const SCOPE_DIALOG_COPY = {
  deleteEvent: { description: "Delete:", title: "Delete recurring event" },
  deleteTask: { description: "Delete:", title: "Delete recurring task" },
  /** A task that doesn't repeat (or an inbox occurrence): no undo. */
  deleteTaskAlone: {
    description: "This can't be undone.",
    title: "Delete task?",
  },
  /** Shown instead of the description when an occurrence's day moves. */
  moveDate: "A new day applies to this occurrence, or from it on.",
  /** Shown when the series' rule couldn't load. */
  seriesFailed:
    "Couldn't load the series, so the new day applies to this occurrence only. Try again later for the rest.",
  /** Shown while a moved day waits for the series' rule. */
  seriesLoading: "Loading the series… This and following opens once it's in.",
  /** Shown instead of the description when the event changes calendar. */
  moveEvent: "Moving to another calendar moves the whole series.",
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

/** What a recurring event's save changes, for the scopes it can use. */
export interface EventSaveChanges {
  /** It moves to another calendar. */
  calendarChanged: boolean;
  /** It moves an occurrence to another day. */
  dateMoved: boolean;
  /** The user changed the repeat. */
  patternChanged: boolean;
  /** Loading the series' rule failed. */
  seriesRuleFailed?: boolean;
  /** The series' rule has loaded (an occurrence's lives on its master). */
  seriesRuleLoaded: boolean;
  /**
   * The series' time zone, when it isn't the one the app shows: its days
   * are counted there, so the dialog says so.
   */
  seriesTimeZone?: string;
}

/**
 * Scopes a recurring event's save can't use. A calendar move applies to
 * the whole series. One occurrence can't repeat differently from its
 * series. A day moved through one occurrence can't apply to the whole
 * series (it keeps its first date; Google's editor offers the same two),
 * and applies from that occurrence on only once the series' rule is known,
 * since the rule follows the new day.
 */
export function eventSaveDisabledScopes(
  changes: EventSaveChanges
): Partial<Record<RecurrenceScope, boolean>> {
  if (changes.calendarChanged) {
    return { following: true, this: true };
  }
  // A changed rule is the user's own, sent with the save: it doesn't wait
  // for the series' rule to load.
  const ruleKnown = changes.seriesRuleLoaded || changes.patternChanged;
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(changes.dateMoved
      ? { all: true, ...(ruleKnown ? {} : { following: true }) }
      : {}),
  };
}

/** `preferred`, or the narrowest scope the save can use when it can't. */
export function allowedEventSaveScope(
  preferred: RecurrenceScope,
  disabled: Partial<Record<RecurrenceScope, boolean>>
): RecurrenceScope {
  if (!disabled[preferred]) {
    return preferred;
  }
  return (
    RECURRENCE_SCOPE_OPTIONS.find((option) => !disabled[option.value])?.value ??
    preferred
  );
}

/** The scope dialog's line for a save. */
export function eventSaveDescription(changes: EventSaveChanges): string {
  if (changes.calendarChanged) {
    return SCOPE_DIALOG_COPY.moveEvent;
  }
  if (!changes.dateMoved) {
    return SCOPE_DIALOG_COPY.saveEvent.description;
  }
  if (!(changes.seriesRuleLoaded || changes.patternChanged)) {
    return changes.seriesRuleFailed
      ? SCOPE_DIALOG_COPY.seriesFailed
      : SCOPE_DIALOG_COPY.seriesLoading;
  }
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  return city
    ? `A new day in ${city} time applies to this occurrence, or from it on.`
    : SCOPE_DIALOG_COPY.moveDate;
}
