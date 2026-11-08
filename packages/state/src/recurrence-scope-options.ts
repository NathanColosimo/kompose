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
import type { Temporal } from "temporal-polyfill";
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
    "Couldn't load the series, so your changes apply to this occurrence only. Try again later for the rest.",
  /** Shown when the series' rule couldn't load, for a save in place. */
  seriesFailedSave:
    "Couldn't load the series, so This and following isn't available. Try again later.",
  /** Shown when the series' rule couldn't load, for a new time. */
  seriesFailedTime:
    "Couldn't load the series, so the new time applies to this occurrence only. Try again later for the rest.",
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
  /**
   * Shown while a new time waits for the series' rule: whether it repeats
   * by more than one rule, which a new time can't keep, isn't known yet.
   */
  seriesLoadingTime:
    "Loading the series… This and following and Entire series open once it's in.",
  /** Shown instead of the description when the event changes calendar. */
  moveEvent: "Moving to another calendar moves the whole series.",
  /** A calendar move while the occurrence is on another day (`dateMoved`). */
  moveEventDay:
    "Moving to another calendar moves the whole series, but this occurrence is now on another day than its series, which can't go with it. Move the calendar and change the day in two saves.",
  /** A calendar move with a new repeat that would skip this occurrence. */
  moveEventRepeatDay:
    "Moving to another calendar moves the whole series, but counted from its first meeting the new repeat would skip this occurrence. Move the calendar and change the repeat in two saves.",
  /** The same, when it's the new end that comes first. */
  moveEventRepeatEnd:
    "Moving to another calendar moves the whole series, but counted from its first meeting the new end comes before this occurrence. Move the calendar and change the repeat in two saves.",
  /**
   * A calendar move with a new time while the series loads, or after it
   * failed to: only Entire series could take both.
   */
  moveEventLoadingTime:
    "Moving to another calendar moves the whole series. Loading the series… Entire series opens once it's in.",
  moveEventFailedTime:
    "Moving to another calendar moves the whole series. Couldn't load the series, so the move and the new time can't be saved together. Try again later.",
  /** A calendar move with a new time for a series of several rules. */
  moveEventSeveralRulesTime:
    "Moving to another calendar moves the whole series, but a new time can't apply to a series that repeats by more than one rule. Move the calendar and change the time in two saves.",
  /** A new time for a series of several rules: Google would mix them up. */
  severalRulesTime:
    "This series repeats by more than one rule, so a new time can't apply to the entire series.",
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
    severalRulesTime: "A new time applies to this occurrence only.",
    timeAndRepeat: "Change the time and the repeat in two saves.",
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
  /**
   * A save would put the series on another day than the occurrence's
   * place in it: moved there in this edit, or before and given new times
   * now (`occurrenceDayMoved`).
   */
  dateMoved: boolean;
  /**
   * The day of a moved (rescheduled) meeting of the series that the new
   * repeat would cancel for Entire series, as the calendar shows it
   * (`movedMeetingDropped`, or the meeting a refused save names).
   */
  droppedMovedDay?: Temporal.PlainDate | null;
  /** The user changed the repeat. */
  patternChanged: boolean;
  /**
   * The new repeat, counted from the series' first meeting as an Entire
   * series save would, no longer has this occurrence's original slot (so
   * Google would cancel it, a moved one too), and why: its day (an
   * implicit day, an interval's phase) or its end (`repeatSkipsOccurrence`).
   */
  repeatSkips?: "day" | "end" | null;
  /**
   * It changes this occurrence's start or end time (or makes it all day,
   * or timed) without moving its day: for the series, a new time.
   */
  retimed?: boolean;
  /** Loading the series' rule failed. */
  seriesRuleFailed?: boolean;
  /** The series' rule has loaded (an occurrence's lives on its master). */
  seriesRuleLoaded: boolean;
  /**
   * The series' time zone, when it isn't the one the app shows: its days
   * are counted there, so the dialog says so.
   */
  seriesTimeZone?: string;
  /** The series repeats by more than one rule (`hasSeveralRules`). */
  severalRules?: boolean;
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
 * series. Entire series keeps the series' first day and every meeting the
 * user moved (`entireSeriesOff`). This and following waits for the
 * series' rule (`followingRuleKnown`), and is off where a new series
 * can't start.
 */
export function eventSaveDisabledScopes(
  changes: EventSaveChanges
): Partial<Record<RecurrenceScope, boolean>> {
  const allOff = entireSeriesOff(changes) !== null;
  if (changes.calendarChanged) {
    return allOff
      ? { all: true, following: true, this: true }
      : { following: true, this: true };
  }
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(allOff ? { all: true } : {}),
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

/** Why Entire series is off (`entireSeriesOff`). */
type EntireSeriesOff =
  | { reason: "movedMeeting"; day: Temporal.PlainDate }
  | {
      reason:
        | "newDay"
        | "repeatDay"
        | "repeatEnd"
        | "seriesPending"
        | "severalRulesTime";
    };

/**
 * Why Entire series is off, or null when it's on. It keeps the series'
 * first day (Google's editor offers the same), so it can't take a day
 * moved through one occurrence ("newDay"). A new repeat can't skip this
 * occurrence's own slot, counted from that first day ("repeatDay",
 * "repeatEnd"), nor cancel a meeting the user moved ("movedMeeting"):
 * Google keeps one only while the rule still has its original slot. A new
 * time can't apply to a series of several rules ("severalRulesTime"):
 * Google would mix them up. Before the series loads, a new repeat or time
 * waits for it ("seriesPending").
 */
function entireSeriesOff(changes: EventSaveChanges): EntireSeriesOff | null {
  const { droppedMovedDay, patternChanged, repeatSkips } = changes;
  if (changes.dateMoved) {
    return { reason: "newDay" };
  }
  if ((patternChanged || changes.retimed) && !changes.seriesRuleLoaded) {
    return { reason: "seriesPending" };
  }
  if (patternChanged && repeatSkips) {
    return { reason: repeatSkips === "day" ? "repeatDay" : "repeatEnd" };
  }
  if (patternChanged && droppedMovedDay) {
    return { day: droppedMovedDay, reason: "movedMeeting" };
  }
  return changes.retimed && changes.severalRules
    ? { reason: "severalRulesTime" }
    : null;
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
 * The scope dialog's line when a save would put the series on another
 * day: the occurrence is now on a day other than its place in the series
 * (moved in this edit, or before and given new times now), counted in the
 * series' zone, named when it isn't the app's. That can't move the whole
 * series, and a new repeat (never one occurrence's) only goes from here.
 */
function newDayLine(changes: EventSaveChanges): string {
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  const where = city
    ? `In ${city} time, this occurrence is now on another day than its series`
    : "This occurrence is now on another day than its series";
  return changes.patternChanged
    ? `${where}, so a new repeat applies from it on.`
    : `${where}, so your changes apply to it, or from it on.`;
}

/** "Dec 7": a moved meeting's day, as the dialog names it. */
function shortDay(day: Temporal.PlainDate): string {
  return day.toLocaleString("en-US", { day: "numeric", month: "short" });
}

/** Why Entire series is off for a new repeat that drops a moved meeting. */
function movedMeetingLine(day: Temporal.PlainDate): string {
  return `The new repeat would drop your moved ${shortDay(day)} meeting, so it can't apply to the entire series.`;
}

/** The scope dialog's line for a calendar move. */
function calendarMoveDescription(changes: EventSaveChanges): string {
  const copy = SCOPE_DIALOG_COPY;
  const off = entireSeriesOff(changes);
  switch (off?.reason) {
    case undefined:
      return copy.moveEvent;
    case "newDay":
      return copy.moveEventDay;
    case "repeatDay":
      return copy.moveEventRepeatDay;
    case "repeatEnd":
      return copy.moveEventRepeatEnd;
    case "movedMeeting":
      return `Moving to another calendar moves the whole series, but the new repeat would drop your moved ${shortDay(off.day)} meeting. Move the calendar and change the repeat in two saves.`;
    case "severalRulesTime":
      return copy.moveEventSeveralRulesTime;
    case "seriesPending":
      if (changes.patternChanged) {
        return `${copy.moveEvent} ${seriesPendingDescription(changes)}`;
      }
      return changes.seriesRuleFailed
        ? copy.moveEventFailedTime
        : copy.moveEventLoadingTime;
    default:
      return off satisfies never;
  }
}

/** The scope dialog's line while the series' rule loads, or failed to. */
function seriesPendingDescription(changes: EventSaveChanges): string {
  const copy = SCOPE_DIALOG_COPY;
  if (changes.patternChanged) {
    return changes.seriesRuleFailed
      ? copy.seriesFailedRepeat
      : copy.seriesLoadingRepeat;
  }
  if (changes.seriesRuleFailed) {
    if (changes.dateMoved) {
      return copy.seriesFailed;
    }
    return changes.retimed ? copy.seriesFailedTime : copy.seriesFailedSave;
  }
  if (changes.dateMoved) {
    return `${newDayLine(changes)} ${copy.seriesLoading}`;
  }
  return changes.retimed ? copy.seriesLoadingTime : copy.seriesLoading;
}

/** The scope dialog's line where This and following can't start a series. */
function splitBlockedDescription(
  changes: EventSaveChanges,
  block: SplitBlock
): string {
  const why = SCOPE_DIALOG_COPY.splitBlocked[block];
  const then = SCOPE_DIALOG_COPY.splitBlockedThen;
  const { patternChanged } = changes;
  const off = entireSeriesOff(changes);
  switch (off?.reason) {
    case undefined:
      return patternChanged ? `${why} ${then.repeat}` : why;
    case "newDay":
      return patternChanged
        ? `${why} ${then.dayAndRepeat}`
        : `${newDayLine(changes)} ${why}`;
    case "repeatDay":
      return `${why} ${then.repeatOffDay}`;
    case "repeatEnd":
      return `${why} ${then.repeatEndOff}`;
    case "movedMeeting":
      return `${why} ${movedMeetingLine(off.day)}`;
    case "severalRulesTime":
      return patternChanged
        ? `${why} ${then.timeAndRepeat}`
        : `${why} ${then.severalRulesTime}`;
    case "seriesPending":
      return seriesPendingDescription(changes);
    default:
      return off satisfies never;
  }
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
  const off = entireSeriesOff(changes);
  switch (off?.reason) {
    case undefined:
      return changes.patternChanged
        ? SCOPE_DIALOG_COPY.repeatChange
        : SCOPE_DIALOG_COPY.saveEvent.description;
    case "newDay":
      return newDayLine(changes);
    case "repeatDay":
      return SCOPE_DIALOG_COPY.repeatOffDay;
    case "repeatEnd":
      return SCOPE_DIALOG_COPY.repeatEndOff;
    case "movedMeeting":
      return movedMeetingLine(off.day);
    case "severalRulesTime":
      return SCOPE_DIALOG_COPY.severalRulesTime;
    case "seriesPending":
      return seriesPendingDescription(changes);
    default:
      return off satisfies never;
  }
}
