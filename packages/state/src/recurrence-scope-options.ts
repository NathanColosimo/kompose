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
  /** A new repeat: one occurrence can't repeat differently from its series. */
  repeatChange:
    "A new repeat applies from this occurrence on, or to the entire series.",
  /** A new repeat that, counted from the series' first meeting, skips this one. */
  repeatOffDay:
    "Counted from the series' first meeting, the new repeat would skip this occurrence, so it applies from here on.",
  /** The same, when it's the new end (COUNT or UNTIL) that comes first. */
  repeatEndOff:
    "Counted from the series' first meeting, the new end comes before this occurrence, so it applies from here on.",
  /** Shown when the series' rule couldn't load, for a moved day. */
  seriesFailed:
    "Couldn't load the series, so the new day applies to this occurrence only. Try again later for the rest.",
  /** Shown when the series' rule couldn't load, for a save in place. */
  seriesFailedSave:
    "Couldn't load the series, so This and following isn't available. Try again later.",
  /** Shown when the series' rule couldn't load, for a new repeat. */
  seriesFailedRepeat:
    "Couldn't load the series, so a new repeat can't be saved. Try again later.",
  /** Shown while a save waits for the series' rule. */
  seriesLoading: "Loading the series… This and following opens once it's in.",
  /**
   * Shown while a new repeat waits for the series' rule: whether, counted
   * from its first meeting, it skips this one isn't known yet.
   */
  seriesLoadingRepeat:
    "Loading the series… A new repeat can be saved once it's in.",
  /** Shown instead of the description when the event changes calendar. */
  moveEvent: "Moving to another calendar moves the whole series.",
  /** A calendar move with a new day for this occurrence. */
  moveEventDay:
    "Moving to another calendar moves the whole series, but a new day applies only to this occurrence, or from it on. Move the calendar and change the day in two saves.",
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
  /**
   * After `splitBlocked`, for what else the save changes: with This and
   * following off, a new repeat can only go to the entire series, and not
   * together with a new day, nor where it would skip this occurrence.
   */
  splitBlockedThen: {
    dayAndRepeat: "Change the day and the repeat in two saves.",
    repeat: "A new repeat applies to the entire series.",
    repeatOffDay:
      "Counted from the series' first meeting, the new repeat would skip this occurrence, so change the repeat from that first meeting.",
    repeatEndOff:
      "Counted from the series' first meeting, the new end comes before this occurrence, so change the repeat from that first meeting.",
  },
  /** Why deleting This and following is off for an occurrence. */
  deleteFollowingOff:
    "This occurrence was added to the series on its own, and Kompose can't tell where the series' repeat ends, so This and following isn't available.",
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
 * series. Entire series keeps the series' first day (see
 * `entireSeriesOff`). This and following waits for the series' rule
 * (`followingRuleKnown`), and is off where a new series can't start.
 */
export function eventSaveDisabledScopes(
  changes: EventSaveChanges
): Partial<Record<RecurrenceScope, boolean>> {
  if (changes.calendarChanged) {
    return entireSeriesOff(changes)
      ? { all: true, following: true, this: true }
      : { following: true, this: true };
  }
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(entireSeriesOff(changes) ? { all: true } : {}),
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
 * Whether Entire series is off. It keeps the series' first day (Google's
 * editor offers the same), so it can't take a day moved through one
 * occurrence, nor a new repeat that, counted from that first day, would
 * skip this occurrence (`repeatSkips`), or might, before the series loads.
 */
function entireSeriesOff(changes: EventSaveChanges): boolean {
  return (
    changes.dateMoved ||
    (changes.patternChanged &&
      Boolean(changes.repeatSkips || !changes.seriesRuleLoaded))
  );
}

/**
 * The scope a save dialog shows and saves with: the user's own pick while
 * it's available, else the preferred one, else the narrowest on. Worked
 * out each time, so a preferred scope that's off for a moment (the series
 * loading) comes back once it's on, unless the user chose another.
 */
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

/**
 * The scope dialog's line for a moved day, in the series' zone when it
 * isn't the app's ("A new day in Tokyo time"): it can't move the whole
 * series, and with a new repeat (never one occurrence's) only goes from
 * this occurrence on.
 */
function newDayLine(changes: EventSaveChanges): string {
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  const day = city ? `A new day in ${city} time` : "A new day";
  return changes.patternChanged
    ? `${day} with a new repeat applies from this occurrence on.`
    : `${day} applies to this occurrence, or from it on.`;
}

/** The scope dialog's line for a calendar move. */
function calendarMoveDescription(changes: EventSaveChanges): string {
  if (changes.patternChanged && changes.repeatSkips) {
    return SCOPE_DIALOG_COPY.moveEventRepeatDay;
  }
  if (changes.dateMoved) {
    return SCOPE_DIALOG_COPY.moveEventDay;
  }
  if (changes.patternChanged && !changes.seriesRuleLoaded) {
    return `${SCOPE_DIALOG_COPY.moveEvent} ${
      changes.seriesRuleFailed
        ? SCOPE_DIALOG_COPY.seriesFailedRepeat
        : SCOPE_DIALOG_COPY.seriesLoadingRepeat
    }`;
  }
  return SCOPE_DIALOG_COPY.moveEvent;
}

/** The scope dialog's line while the series' rule loads, or failed to. */
function seriesPendingDescription(changes: EventSaveChanges): string {
  if (changes.patternChanged) {
    return changes.seriesRuleFailed
      ? SCOPE_DIALOG_COPY.seriesFailedRepeat
      : SCOPE_DIALOG_COPY.seriesLoadingRepeat;
  }
  if (changes.seriesRuleFailed) {
    return changes.dateMoved
      ? SCOPE_DIALOG_COPY.seriesFailed
      : SCOPE_DIALOG_COPY.seriesFailedSave;
  }
  return changes.dateMoved
    ? `${newDayLine(changes)} ${SCOPE_DIALOG_COPY.seriesLoading}`
    : SCOPE_DIALOG_COPY.seriesLoading;
}

/** The scope dialog's line where This and following can't start a series. */
function splitBlockedDescription(
  changes: EventSaveChanges,
  block: SplitBlock
): string {
  const why = SCOPE_DIALOG_COPY.splitBlocked[block];
  const then = SCOPE_DIALOG_COPY.splitBlockedThen;
  if (changes.dateMoved) {
    return changes.patternChanged
      ? `${why} ${then.dayAndRepeat}`
      : `${newDayLine(changes)} ${why}`;
  }
  if (!changes.patternChanged) {
    return why;
  }
  if (changes.repeatSkips === "day") {
    return `${why} ${then.repeatOffDay}`;
  }
  return changes.repeatSkips === "end"
    ? `${why} ${then.repeatEndOff}`
    : `${why} ${then.repeat}`;
}

/** The scope dialog's line for a save: why each scope that's off is. */
export function eventSaveDescription(changes: EventSaveChanges): string {
  if (changes.calendarChanged) {
    return calendarMoveDescription(changes);
  }
  if (!followingRuleKnown(changes)) {
    return seriesPendingDescription(changes);
  }
  if (changes.splitBlocked) {
    return splitBlockedDescription(changes, changes.splitBlocked);
  }
  if (changes.dateMoved) {
    return newDayLine(changes);
  }
  if (!changes.patternChanged) {
    return SCOPE_DIALOG_COPY.saveEvent.description;
  }
  if (changes.repeatSkips === "day") {
    return SCOPE_DIALOG_COPY.repeatOffDay;
  }
  return changes.repeatSkips === "end"
    ? SCOPE_DIALOG_COPY.repeatEndOff
    : SCOPE_DIALOG_COPY.repeatChange;
}
