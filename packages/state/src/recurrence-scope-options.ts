import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  followingSplitBlocked,
  type SplitBlock,
} from "@kompose/google-cal/recurrence-utils";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { eventTimeZone, timeZoneCity } from "./google-event-recurrence";

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
  /** Shown when the series' rule couldn't load, for a save in place. */
  seriesFailedSave:
    "Couldn't load the series, so This and following isn't available. Try again later.",
  /** Shown while a save waits for the series' rule. */
  seriesLoading: "Loading the series… This and following opens once it's in.",
  /** Shown instead of the description when the event changes calendar. */
  moveEvent: "Moving to another calendar moves the whole series.",
  saveEvent: {
    description: "Apply your changes to:",
    title: "Save recurring event",
  },
  /** Why This and following is off for an occurrence. */
  splitBlocked: {
    addedOccurrence:
      "This occurrence was added to the series on its own, so This and following isn't available.",
    severalRules:
      "This series repeats by more than one rule, so This and following isn't available.",
  } satisfies Record<SplitBlock, string>,
  /** An added occurrence moved to a new day with a new repeat: no scope fits. */
  splitBlockedAll:
    "An added occurrence can't move to another day and change its repeat in one save. Change one, then the other.",
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
  /** Why a new series can't start at this occurrence (`seriesSplitBlock`). */
  splitBlocked?: SplitBlock | null;
}

/**
 * Why "This and following" can't start a new series at `occurrence`: an
 * added (RDATE) meeting, or a series with several rules. Null when it
 * can, or before the series' master loads.
 */
export function seriesSplitBlock(
  occurrence:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId" | "start">
    | null
    | undefined,
  master: Pick<GoogleEvent, "recurrence" | "start"> | null | undefined,
  appTimeZone: string
): SplitBlock | null {
  const original = occurrence?.originalStartTime;
  const originalStart = original?.dateTime ?? original?.date;
  if (!(occurrence?.recurringEventId && master && originalStart)) {
    return null;
  }
  return followingSplitBlocked({
    masterRecurrence: master.recurrence,
    masterStart: master.start,
    originalStart,
    seriesZone: eventTimeZone(occurrence, appTimeZone),
  });
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
  // Whether a new series can start here is known once the series loads.
  // A new repeat on a new day can only go from here on, so it stays
  // offered (the server still refuses it where a series can't start).
  const ruleKnown =
    changes.seriesRuleLoaded || (changes.patternChanged && changes.dateMoved);
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(changes.dateMoved ? { all: true } : {}),
    // Until the series loads, it isn't known whether a new series can
    // start here (or where the rule follows a new day to).
    ...(ruleKnown && !changes.splitBlocked ? {} : { following: true }),
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
  if (changes.splitBlocked) {
    const why = SCOPE_DIALOG_COPY.splitBlocked[changes.splitBlocked];
    if (changes.dateMoved && changes.patternChanged) {
      return SCOPE_DIALOG_COPY.splitBlockedAll;
    }
    return changes.dateMoved ? `${SCOPE_DIALOG_COPY.moveDate} ${why}` : why;
  }
  if (
    !(changes.seriesRuleLoaded || (changes.patternChanged && changes.dateMoved))
  ) {
    if (changes.seriesRuleFailed) {
      return changes.dateMoved
        ? SCOPE_DIALOG_COPY.seriesFailed
        : SCOPE_DIALOG_COPY.seriesFailedSave;
    }
    return SCOPE_DIALOG_COPY.seriesLoading;
  }
  if (!changes.dateMoved) {
    return SCOPE_DIALOG_COPY.saveEvent.description;
  }
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  return city
    ? `A new day in ${city} time applies to this occurrence, or from it on.`
    : SCOPE_DIALOG_COPY.moveDate;
}
