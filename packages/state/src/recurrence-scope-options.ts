import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  followingCutUnsure,
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
  /** A new repeat that, counted from the series' first meeting, skips this one. */
  repeatOffDay:
    "Counted from the series' first meeting, the new repeat would skip this occurrence, so it applies from here on.",
  /** The same, when it's the new end (COUNT or UNTIL) that comes first. */
  repeatEndOff:
    "Counted from the series' first meeting, the new end comes before this occurrence, so it applies from here on.",
  /** The same, on an occurrence added on its own (no new series there). */
  repeatOffDayAdded:
    "This occurrence was added to the series on its own, and counted from the series' first meeting the new repeat would skip it. Change the repeat from one of the series' regular occurrences.",
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
  /** A calendar move with a new repeat that takes this occurrence's day. */
  moveEventRepeatDay:
    "Moving to another calendar moves the whole series, but counted from its first meeting the new repeat would skip this occurrence. Move the calendar and change the repeat in two saves.",
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
  /** Why deleting This and following is off for an occurrence. */
  deleteFollowingOff:
    "This occurrence was added to the series on its own, and Kompose can't tell where the series' repeat ends, so This and following isn't available.",
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
  /**
   * The new repeat, counted from the series' first meeting as an Entire
   * series save would, skips this occurrence, and why: its day (an
   * implicit day, an interval's phase) or its end (`repeatSkipsOccurrence`).
   */
  repeatSkips?: "day" | "end" | null;
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
 * The recurring delete dialog's state: This and following is off until the
 * series loads (and if it failed), or where the cut is unsure; with the
 * line that says why.
 */
export function eventDeleteScopeState(params: {
  cutUnsure: boolean;
  seriesRuleFailed?: boolean;
  seriesRuleLoaded: boolean;
}): {
  description: string;
  disabled: Partial<Record<RecurrenceScope, boolean>>;
} {
  if (!params.seriesRuleLoaded) {
    return {
      description: params.seriesRuleFailed
        ? SCOPE_DIALOG_COPY.seriesFailedSave
        : SCOPE_DIALOG_COPY.seriesLoading,
      disabled: { following: true },
    };
  }
  return params.cutUnsure
    ? {
        description: SCOPE_DIALOG_COPY.deleteFollowingOff,
        disabled: { following: true },
      }
    : { description: SCOPE_DIALOG_COPY.deleteEvent.description, disabled: {} };
}

/**
 * Whether deleting "This and following" from `occurrence` is off: it's an
 * added meeting, and where its series' rule ends can't be told, so the
 * cut could reach past it (the server refuses it too). False before the
 * series' master loads.
 */
export function seriesCutUnsure(
  occurrence:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId" | "start">
    | null
    | undefined,
  master: Pick<GoogleEvent, "recurrence" | "start"> | null | undefined,
  appTimeZone: string
): boolean {
  const split = splitAt(occurrence, master, appTimeZone);
  return split ? followingCutUnsure(split) : false;
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
  const split = splitAt(occurrence, master, appTimeZone);
  return split ? followingSplitBlocked(split) : null;
}

/**
 * Where "This and following" would split `occurrence`'s series, as the
 * server reads it; null for an event that isn't an occurrence, or before
 * its series' master loads.
 */
function splitAt(
  occurrence:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId" | "start">
    | null
    | undefined,
  master: Pick<GoogleEvent, "recurrence" | "start"> | null | undefined,
  appTimeZone: string
): Parameters<typeof followingSplitBlocked>[0] | null {
  const original = occurrence?.originalStartTime;
  const originalStart = original?.dateTime ?? original?.date;
  if (!(occurrence?.recurringEventId && master && originalStart)) {
    return null;
  }
  return {
    masterRecurrence: master.recurrence,
    masterStart: master.start,
    originalStart,
    // The series' own zone first, as the server reads it.
    seriesZone:
      master.start?.timeZone ?? eventTimeZone(occurrence, appTimeZone),
  };
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
    // Only the whole series moves calendars; a new repeat that takes its
    // day from this occurrence can't go with it (the series keeps its own).
    return repeatTakesOccurrenceDay(changes)
      ? { all: true, following: true, this: true }
      : { following: true, this: true };
  }
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(allEventsOff(changes) ? { all: true } : {}),
    ...(followingRuleKnown(changes) && !changes.splitBlocked
      ? {}
      : { following: true }),
  };
}

/**
 * Whether This and following knows the rule it would save: once the series
 * loads (until then, whether a new series can start here, or where its rule
 * follows a new day to, isn't known), or for a new repeat on a new day,
 * which brings its own rule (the server still refuses it where a series
 * can't start).
 */
function followingRuleKnown(changes: EventSaveChanges): boolean {
  return (
    changes.seriesRuleLoaded || (changes.patternChanged && changes.dateMoved)
  );
}

/**
 * Whether "All events" is off: a day moved through one occurrence, or a new
 * repeat on an occurrence that's off its series' day (the series keeps its
 * own first day, so the repeat's days would differ from the editor's).
 */
function allEventsOff(changes: EventSaveChanges): boolean {
  return changes.dateMoved || repeatTakesOccurrenceDay(changes);
}

/** A new repeat whose implicit day comes from this occurrence. */
function repeatTakesOccurrenceDay(changes: EventSaveChanges): boolean {
  return Boolean(changes.patternChanged && changes.repeatSkips);
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

/**
 * The scope a save dialog shows and saves with: the user's own pick while
 * it's available, else the nearest available to the preferred one. Worked
 * out each time, so a preferred scope that's off for a moment (the series
 * loading) comes back once it's on, unless the user chose another.
 */
export function chosenScope(
  pick: RecurrenceScope | null,
  preferred: RecurrenceScope,
  disabled: Partial<Record<RecurrenceScope, boolean>>
): RecurrenceScope {
  return pick && !disabled[pick]
    ? pick
    : allowedEventSaveScope(preferred, disabled);
}

/** The scope dialog's line where This and following can't start a series. */
function splitBlockedDescription(
  changes: EventSaveChanges,
  block: SplitBlock
): string {
  const why = SCOPE_DIALOG_COPY.splitBlocked[block];
  if (changes.dateMoved && changes.patternChanged) {
    return SCOPE_DIALOG_COPY.splitBlockedAll;
  }
  if (allEventsOff(changes) && changes.patternChanged) {
    return SCOPE_DIALOG_COPY.repeatOffDayAdded;
  }
  return changes.dateMoved ? `${SCOPE_DIALOG_COPY.moveDate} ${why}` : why;
}

/** The scope dialog's line for a save. */
export function eventSaveDescription(changes: EventSaveChanges): string {
  if (changes.calendarChanged) {
    return repeatTakesOccurrenceDay(changes)
      ? SCOPE_DIALOG_COPY.moveEventRepeatDay
      : SCOPE_DIALOG_COPY.moveEvent;
  }
  if (changes.splitBlocked) {
    return splitBlockedDescription(changes, changes.splitBlocked);
  }
  if (!followingRuleKnown(changes)) {
    if (changes.seriesRuleFailed) {
      return changes.dateMoved
        ? SCOPE_DIALOG_COPY.seriesFailed
        : SCOPE_DIALOG_COPY.seriesFailedSave;
    }
    return SCOPE_DIALOG_COPY.seriesLoading;
  }
  if (!changes.dateMoved) {
    if (!allEventsOff(changes)) {
      return SCOPE_DIALOG_COPY.saveEvent.description;
    }
    return changes.repeatSkips === "end"
      ? SCOPE_DIALOG_COPY.repeatEndOff
      : SCOPE_DIALOG_COPY.repeatOffDay;
  }
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  return city
    ? `A new day in ${city} time applies to this occurrence, or from it on.`
    : SCOPE_DIALOG_COPY.moveDate;
}
