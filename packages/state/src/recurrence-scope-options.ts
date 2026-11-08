import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  addsBeforeStart,
  carryCountExactly,
  countOf,
  followingCutUnsure,
  followingSplitBlocked,
  type SplitBlock,
  splitAddedDays,
} from "@kompose/google-cal/recurrence-utils";
import type {
  Event as GoogleEvent,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import {
  refusalMessage,
  type SeriesRefusal,
  sameTime,
} from "@kompose/google-cal/series-edits";
import {
  googleDateTime,
  meetsSeveralTimesADay,
  startInstant,
} from "@kompose/google-cal/until";
import { ORPCError } from "@orpc/client";
import { Temporal } from "temporal-polyfill";
import {
  type EntireSeriesCost,
  seriesTimeZone,
  timeZoneCity,
} from "./google-event-recurrence";
import type { StartTime } from "./google-event-times";

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
  /** A new repeat where Entire series is off: only This and following takes it. */
  repeatFromHere: "A new repeat applies from this occurrence on.",
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
  /** The same, where the server refused This and following. */
  seriesLoadingAll: "Loading the series… Entire series opens once it's in.",
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
    "Moving to another calendar moves the whole series, but this occurrence is now on another day than its series, which can't go with it. Move the calendar and change the times in two saves.",
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
  /** A calendar move the server refused for the whole series. */
  moveEventRefused:
    "Moving to another calendar moves the whole series, so move it in a save of its own first.",
  /** A calendar move with a new time for a series meeting several times a day. */
  moveEventSeveralRulesTime:
    "Moving to another calendar moves the whole series, but its meetings keep times of their own, so a new time can't go with it. Move the calendar and change the time in two saves.",
  /** Why a series meeting several times a day can't take a new time. */
  severalRulesTimeReason:
    "This series' meetings keep times of their own, so a new time can't apply to the entire series.",
  /** After `severalRulesTimeReason`, with This and following on. */
  newTimeHere: "A new time applies to this occurrence, or from it on.",
  /**
   * With a new repeat where This and following is off too, after why
   * Entire series is: so no scope is left (`noScopeStep`).
   */
  repeatNotAlone: "One occurrence can't take a new repeat either.",
  /** The same with a new repeat on the meeting's own day. */
  severalRulesTimeAndRepeatReason:
    "This series' meetings keep times of their own, so a new time can't apply to the entire series, nor a new repeat to one occurrence.",
  /**
   * For new times and a new repeat where a meeting changed on its own is
   * at stake: the times can be saved alone; whether the repeat then can
   * is the next save's to say.
   */
  timesFirst: "Save the new times on their own first.",
  /**
   * For a new repeat the server refused for undoing meetings changed on
   * their own (it named them), with no new times to save first.
   */
  keepRefusedMeetings: "Pick a repeat that keeps those occurrences.",
  /**
   * For a new repeat that, counted from the series' first meeting, skips
   * this occurrence, where This and following is off: only Entire series,
   * saved from that first meeting, could take it.
   */
  repeatFromFirstMeeting: "Change the repeat from that first meeting.",
  /** For new times and a new repeat no scope takes together. */
  timesAndRepeat: "Change the times and the repeat in two saves.",
  /** After why Entire series is off, from the series' first meeting. */
  firstMeetingFollowing:
    "From its first meeting, This and following is the entire series too.",
  saveEvent: {
    description: "Apply your changes to:",
    title: "Save recurring event",
  },
  /**
   * Why This and following is off for an occurrence, as the server refuses
   * it (`refusalReason`).
   */
  splitBlocked: {
    addedBeforeStart: refusalReason({ reason: "addedBeforeStart" }),
    addedOccurrence: refusalReason({ reason: "addedOccurrence" }),
    countUnknown: refusalReason({ reason: "countUnknown" }),
    severalRules: refusalReason({ reason: "severalRules" }),
  } satisfies Record<FollowingBlock, string>,
  /**
   * After `splitBlocked`, for what else the save changes: with This and
   * following off, a new repeat can only go to the entire series, and not
   * where it would skip this occurrence, or with times the series can't
   * take (no scope is left then: `noScopeStep`).
   */
  splitBlockedThen: {
    repeat: "A new repeat applies to the entire series.",
    repeatOffDay:
      "Counted from the series' first meeting, the new repeat would skip this occurrence.",
    repeatEndOff:
      "Counted from the series' first meeting, the new end comes before this occurrence.",
    severalRulesTime: "A new time applies to this occurrence only.",
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
   * Replaced by `entireSeriesCost`, and read where that's unset, until the
   * app layers set it (`movedMeetingDropped`: a moved meeting a new repeat
   * drops).
   */
  droppedMovedDay?: Temporal.PlainDate | null;
  /**
   * What an Entire series save would cost a meeting changed on its own,
   * which the server refuses (`entireSeriesCost`).
   */
  entireSeriesCost?: EntireSeriesCost | null;
  /**
   * An Entire series save would give a series meeting several times a day
   * a new time of day, which the server refuses
   * (`entireSeriesMovesSeveralADay`). Left out, `retimed` with
   * `severalRules` is read as that.
   */
  movesSeveralADay?: boolean;
  /**
   * The occurrence is its series' first meeting (`opensSeries`): This and
   * following from there is the whole series, which the server refuses
   * for the same reasons as Entire series.
   */
  opensSeries?: boolean;
  /** The user changed the repeat. */
  patternChanged: boolean;
  /**
   * The scopes the server refused for this save, and why the latest was
   * (`refuseSave`): they stay off, and the dialog leads with its reason.
   */
  refused?: SaveRefusals | null;
  /**
   * The new repeat, counted from the series' first meeting as an Entire
   * series save would, no longer has this occurrence's original slot (so
   * Google would cancel it, a moved one too), and why: its day (an
   * implicit day, an interval's phase) or its end (`repeatSkipsOccurrence`).
   */
  repeatSkips?: "day" | "end" | null;
  /**
   * An Entire series save would move the series' start: its time, its
   * day (through its first meeting) or its all-day form
   * (`entireSeriesStartMoves`; a new length alone doesn't).
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
  /**
   * The series meets more than once a day, so its time can't change as a
   * whole (`seriesMeetsSeveralTimesADay`; `hasSeveralRules` sees only
   * several rules).
   */
  severalRules?: boolean;
  /** Why a new series can't start at this occurrence (`seriesSplitBlock`). */
  splitBlocked?: FollowingBlock | null;
}

/**
 * Why This and following can't start a new series at an occurrence, each
 * a reason the server refuses it for (`seriesSplitBlock`).
 */
export type FollowingBlock = SplitBlock | "addedBeforeStart" | "countUnknown";

/** The scopes the server refused for one pending save, and why. */
export interface SaveRefusals {
  /**
   * Each refusal's reason, latest first (`refusalReason`); the dialog
   * says where else the save can go, from the scopes left.
   */
  message: string;
  /** Each refusal, latest first, with the scope it was for. */
  refusals: readonly { refusal: SeriesRefusal; scope: RecurrenceScope }[];
  scopes: Partial<Record<RecurrenceScope, true>>;
}

/** `refused` with `scope` refused too, for `refusal`. */
export function refuseSave(
  refused: SaveRefusals | null | undefined,
  scope: RecurrenceScope,
  refusal: SeriesRefusal
): SaveRefusals {
  const refusals = [{ refusal, scope }, ...(refused?.refusals ?? [])];
  const reasons = refusals.map((each) => refusalReason(each.refusal));
  return {
    message: [...new Set(reasons)].join(" "),
    refusals,
    scopes: { ...refused?.scopes, [scope]: true },
  };
}

/**
 * Why the server refused a series write, without its advice on where to
 * save instead (`refusalMessage` names scopes the dialog may have off):
 * the dialog says that from the scopes left.
 */
export function refusalReason(refusal: SeriesRefusal): string {
  switch (refusal.reason) {
    case "addedBeforeStart":
      return "This and following isn't available from this series' first meeting, since meetings were added before it.";
    case "severalTimesADay":
      return "This series' meetings keep times of their own, so its time can't be changed for the entire series.";
    case "dropsChangedOccurrences":
      return `This would undo changes made to single occurrences (${refusalDays(refusal)}), so it wasn't saved.`;
    case "resizesChangedOccurrences":
      return `This would also change the length of single occurrences given a length of their own (${refusalDays(refusal)}), so it wasn't saved.`;
    case "endsBeforeStart":
      return "The repeat ends before this occurrence, so it can't start a new series here.";
    // The server's words give no advice.
    case "addedOccurrence":
    case "countUnknown":
    case "deleteFromAddedOccurrence":
    case "severalRules":
      return refusalMessage(refusal);
    default:
      return refusal satisfies never;
  }
}

/** "Dec 7, Dec 8": the occurrences a refusal names, by their original days. */
function refusalDays(refusal: ListRefusal): string {
  return refusal.originalStarts
    .map((start) => shortDay(Temporal.PlainDate.from(start.slice(0, 10))))
    .join(", ");
}

/** A refusal that names the occurrences it's for. */
type ListRefusal = Extract<SeriesRefusal, { originalStarts: unknown }>;

/**
 * Every reason a series write is refused for, to tell one from data, by
 * whether it names occurrences: a new reason of either kind fails to
 * compile until it's listed.
 */
const PLAIN_REASONS: Record<
  Exclude<SeriesRefusal, ListRefusal>["reason"],
  true
> = {
  addedBeforeStart: true,
  addedOccurrence: true,
  countUnknown: true,
  deleteFromAddedOccurrence: true,
  endsBeforeStart: true,
  severalRules: true,
  severalTimesADay: true,
};
const LIST_REASONS: Record<ListRefusal["reason"], true> = {
  dropsChangedOccurrences: true,
  resizesChangedOccurrences: true,
};

const isPlainReason = (
  reason: string
): reason is Exclude<SeriesRefusal, ListRefusal>["reason"] =>
  Object.hasOwn(PLAIN_REASONS, reason);
const isListReason = (reason: string): reason is ListRefusal["reason"] =>
  Object.hasOwn(LIST_REASONS, reason);

/**
 * The server's refusal of a series write, from a failed save or delete:
 * a BAD_REQUEST whose typed data says why (a `SeriesRefusal`). Null for
 * any other failure, which a retry may get past.
 */
export function seriesRefusalOf(error: unknown): SeriesRefusal | null {
  if (!(error instanceof ORPCError && error.code === "BAD_REQUEST")) {
    return null;
  }
  const data: unknown = error.data;
  if (!(typeof data === "object" && data !== null && "reason" in data)) {
    return null;
  }
  const { reason } = data;
  if (typeof reason !== "string") {
    return null;
  }
  if (isPlainReason(reason)) {
    return { reason };
  }
  const starts = "originalStarts" in data ? data.originalStarts : null;
  return isListReason(reason) &&
    Array.isArray(starts) &&
    starts.every((start) => typeof start === "string")
    ? { originalStarts: starts, reason }
    : null;
}

/**
 * The recurring delete dialog's state: This and following is off until the
 * series loads (and if it failed), or where the cut is unsure; with the
 * line that says why. Scopes the server refused for this delete stay off,
 * led by its reason.
 */
export function eventDeleteScopeState(params: {
  cutUnsure: boolean;
  /** The scopes the server refused for this delete (`refuseSave`). */
  refused?: SaveRefusals | null;
  seriesRuleFailed?: boolean;
  seriesRuleLoaded: boolean;
}): {
  description: string;
  disabled: Partial<Record<RecurrenceScope, boolean>>;
} {
  const own = deleteScopesOff(params);
  const { refused } = params;
  if (!refused) {
    return own;
  }
  // Own reasons are all about This and following: past its refusal,
  // they'd promise or explain what the refusal settles.
  const description = refused.scopes.following
    ? SCOPE_DIALOG_COPY.deleteEvent.description
    : own.description;
  return {
    description: `${refused.message} ${description}`,
    disabled: { ...own.disabled, ...refused.scopes },
  };
}

/** What the delete's own state rules out (`eventDeleteScopeState`). */
function deleteScopesOff(params: {
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
 * Why "This and following" can't start a new series at `occurrence`, as
 * the server refuses it. From the series' first meeting it's the whole
 * series, refused only when meetings were added before that one. From
 * any other: an added (RDATE) meeting, a series with several rules, or a
 * COUNT whose meetings left can't be worked out. Null when it can, or
 * before the series' master loads.
 */
export function seriesSplitBlock(
  occurrence:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId" | "start">
    | null
    | undefined,
  master: Pick<GoogleEvent, "recurrence" | "start"> | null | undefined,
  appTimeZone: string,
  /** The repeat the save sends; undefined keeps the series'. */
  recurrence?: string[]
): FollowingBlock | null {
  const split = splitAt(occurrence, master, appTimeZone);
  if (!(split && master)) {
    return null;
  }
  const masterRecurrence = master.recurrence ?? [];
  if (opensSeries(occurrence, master, appTimeZone)) {
    return addsBeforeStart(masterRecurrence, master.start, split.seriesZone)
      ? "addedBeforeStart"
      : null;
  }
  return (
    followingSplitBlocked(split) ??
    (countLeftUnknown({ ...split, masterRecurrence, recurrence })
      ? "countUnknown"
      : null)
  );
}

/**
 * Whether `occurrence` is its series' first meeting (at the series' own
 * start), as the server reads it: This and following from there saves
 * the whole series, and Entire series moves its start with it. False for
 * an event that isn't an occurrence, or before the series' master loads.
 */
export function opensSeries(
  occurrence:
    | Pick<GoogleEvent, "originalStartTime" | "recurringEventId" | "start">
    | null
    | undefined,
  master: Pick<GoogleEvent, "start"> | null | undefined,
  appTimeZone: string
): boolean {
  if (!(occurrence?.recurringEventId && master)) {
    return false;
  }
  const zone = seriesTimeZone(occurrence, master.start, appTimeZone);
  return sameTime(
    occurrence.originalStartTime ?? occurrence.start,
    master.start,
    zone
  );
}

/**
 * Whether a split can't carry on the series' COUNT, as the server reads
 * it: the save keeps the COUNT, and `carryCount` can't work out what's
 * left whatever Google lists. That's a rule it can't walk
 * (`carryCountExactly`) in a series with added days. A skip Google
 * doesn't list also stops it, but only the server reads that list.
 */
function countLeftUnknown(params: {
  masterRecurrence: string[];
  masterStart: StartTime;
  originalStart: string;
  recurrence: string[] | undefined;
  seriesZone: string;
}): boolean {
  const { masterRecurrence, originalStart, seriesZone } = params;
  const count = countOf(masterRecurrence);
  // The new part's rule, its added days from the split on.
  const rule = splitAddedDays(
    params.recurrence ?? masterRecurrence,
    originalStart,
    seriesZone,
    "from"
  );
  if (count === undefined || countOf(rule) !== count) {
    return false;
  }
  const exact = carryCountExactly(rule, {
    masterRecurrence,
    originalStart,
    seriesStart: seriesSlotOf(params.masterStart, seriesZone) ?? originalStart,
    seriesZone,
  });
  // Past the walk, it counts from Google's list, where an added day
  // can't be told apart from a rule day.
  return (
    exact === null && masterRecurrence.some((line) => line.startsWith("RDATE"))
  );
}

/**
 * Whether a series meets more than once a day, as the server reads it
 * when refusing a new time for the entire series: two rules at different
 * times, or one at a time other than the series' start's.
 */
export function seriesMeetsSeveralTimesADay(
  master: Pick<GoogleEvent, "recurrence" | "start">,
  appTimeZone: string
): boolean {
  const zone = master.start.timeZone ?? appTimeZone;
  const start =
    startInstant(master.start, zone)?.toZonedDateTimeISO(zone).toPlainTime() ??
    null;
  return meetsSeveralTimesADay(master.recurrence ?? [], start);
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
  if (!(occurrence?.recurringEventId && master && original)) {
    return null;
  }
  // The series' own zone first, as the server reads it.
  const seriesZone = seriesTimeZone(occurrence, master.start, appTimeZone);
  const originalStart = seriesSlotOf(original, seriesZone);
  return originalStart
    ? {
        masterRecurrence: master.recurrence,
        masterStart: master.start,
        originalStart,
        seriesZone,
      }
    : null;
}

/**
 * A start as its series' slot, as the server reads one (its `slotOf`): a
 * date, or a date-time with the series' offset (one Google wrote without
 * an offset read in its own zone). Null when it has neither.
 */
function seriesSlotOf(start: StartTime, seriesZone: string): string | null {
  if (start.date) {
    return start.date;
  }
  const moment = startInstant(start, seriesZone);
  return moment ? googleDateTime(moment.toZonedDateTimeISO(seriesZone)) : null;
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
  return { ...scopesOff(changes), ...changes.refused?.scopes };
}

/** The scopes the save's own changes rule out (`eventSaveDisabledScopes`). */
function scopesOff(
  changes: EventSaveChanges
): Partial<Record<RecurrenceScope, boolean>> {
  const allOff = entireSeriesOff(changes) !== null;
  if (changes.calendarChanged) {
    return allOff
      ? { all: true, following: true, this: true }
      : { following: true, this: true };
  }
  const followingOn =
    followingRuleKnown(changes) &&
    !changes.splitBlocked &&
    !firstMeetingRefused(changes) &&
    !refusedScopes(changes).following;
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(allOff ? { all: true } : {}),
    ...(followingOn ? {} : { following: true }),
  };
}

/**
 * Whether This and following from the series' first meeting is refused
 * as Entire series is: the server saves it as the whole series. A new day
 * there moves the series' start, which it refuses only for what that
 * start changes (`firstMeetingNewDayRefusal`).
 */
function firstMeetingRefused(changes: EventSaveChanges): boolean {
  const off = entireSeriesOff(changes);
  if (!(changes.opensSeries && off)) {
    return false;
  }
  return off.reason !== "newDay" || firstMeetingNewDayRefusal(changes) !== null;
}

/**
 * Why the server refuses a new day through the series' first meeting,
 * which it saves as the whole series from that day, in its order: a new
 * time of day for a series meeting several times a day, then a meeting
 * changed on its own, which the new start resets (Google cancels them
 * all, so whatever the cost's reason, the line says the earliest is
 * reset). Null when it takes it. Only `movesSeveralADay` tells a new time
 * of day here: `retimed` is set by the new day alone.
 */
function firstMeetingNewDayRefusal(
  changes: EventSaveChanges
):
  | { reason: "severalTimesADay" }
  | { cost: EntireSeriesCost; reason: "changedMeeting" }
  | null {
  if (!(changes.opensSeries && changes.dateMoved)) {
    return null;
  }
  if (changes.movesSeveralADay) {
    return { reason: "severalTimesADay" };
  }
  const cost = changedMeetingCost(changes);
  return cost ? { cost, reason: "changedMeeting" } : null;
}

/** Why the server refuses a first meeting's new day (`firstMeetingNewDayRefusal`), in words. */
function firstMeetingNewDayLine(
  refusal: NonNullable<ReturnType<typeof firstMeetingNewDayRefusal>>
): string {
  switch (refusal.reason) {
    case "severalTimesADay":
      return SCOPE_DIALOG_COPY.severalRulesTimeReason;
    case "changedMeeting":
      return `Moving the series to this day would reset your changed ${shortDay(refusal.cost.day)} meeting.`;
    default:
      return refusal satisfies never;
  }
}

/**
 * What to do where the save is left no scope (`eventSaveDescription`),
 * after saying why. Null where the line already says it: a calendar move,
 * or the series loading, while that can open a scope. Off every scope but
 * by a calendar move, a save has a new repeat, as only that turns Only
 * this off.
 */
function noScopeStepFor(changes: EventSaveChanges): string | null {
  if (changes.calendarChanged) {
    return null;
  }
  const pending = !followingRuleKnown(changes);
  const opens = loadingOpens(changes);
  if (pending && (opens.all || opens.following)) {
    return null;
  }
  const off = eventSaveDisabledScopes(changes);
  return off.all && off.following && off.this ? noScopeStep(changes) : null;
}

/**
 * The step for new times and a new repeat no scope takes together. With a
 * meeting changed on its own at stake, save the new times on their own
 * first (a cost found for them can hide one the repeat has alone, which
 * the next save's dialog then says); for a repeat that itself undoes one
 * (with no new day: that's new times too), pick a repeat that keeps it.
 * The same for a server refusal naming such meetings. For a repeat that
 * skips this occurrence, change it from the series' first meeting, where
 * Entire series takes it. Else change the times and the repeat in two
 * saves.
 */
function noScopeStep(changes: EventSaveChanges): string {
  const cost = changedMeetingCost(changes);
  if (cost) {
    return cost.reason === "lostSlot" && !changes.dateMoved
      ? `Pick a repeat that keeps the ${shortDay(cost.day)} meeting.`
      : SCOPE_DIALOG_COPY.timesFirst;
  }
  const named = changes.refused?.refusals.find(({ refusal }) =>
    isListReason(refusal.reason)
  );
  if (named) {
    return named.refusal.reason === "dropsChangedOccurrences" &&
      !(changes.retimed || changes.dateMoved)
      ? SCOPE_DIALOG_COPY.keepRefusedMeetings
      : SCOPE_DIALOG_COPY.timesFirst;
  }
  return changes.patternChanged && changes.repeatSkips
    ? SCOPE_DIALOG_COPY.repeatFromFirstMeeting
    : SCOPE_DIALOG_COPY.timesAndRepeat;
}

/** Whether the server refuses the save's new time for the series (`movesSeveralADay`). */
function severalADayRefused(changes: EventSaveChanges): boolean {
  return (
    changes.movesSeveralADay ?? Boolean(changes.retimed && changes.severalRules)
  );
}

/**
 * What an Entire series save would cost a meeting changed on its own
 * (`entireSeriesCost`, or the deprecated `droppedMovedDay` under a new
 * repeat), or null.
 */
function changedMeetingCost(
  changes: EventSaveChanges
): EntireSeriesCost | null {
  return (
    changes.entireSeriesCost ??
    (changes.patternChanged && changes.droppedMovedDay
      ? { day: changes.droppedMovedDay, reason: "lostSlot" }
      : null)
  );
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
  | { reason: "changedMeeting"; cost: EntireSeriesCost }
  | {
      reason:
        | "newDay"
        | "refused"
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
 * "repeatEnd"). A new time can't apply to a series of several rules
 * ("severalRulesTime"): Google would mix them up. Nor can a save cost a
 * meeting changed on its own what's its own ("changedMeeting",
 * `entireSeriesCost`): the server refuses it. Before the series loads, a
 * new repeat or time waits for it ("seriesPending"). Past those, the
 * server may still have refused it ("refused", `refuseSave`).
 */
function entireSeriesOff(changes: EventSaveChanges): EntireSeriesOff | null {
  const { patternChanged, repeatSkips, retimed } = changes;
  if (changes.dateMoved) {
    return { reason: "newDay" };
  }
  if ((patternChanged || retimed) && !changes.seriesRuleLoaded) {
    return { reason: "seriesPending" };
  }
  if (patternChanged && repeatSkips) {
    return { reason: repeatSkips === "day" ? "repeatDay" : "repeatEnd" };
  }
  if (severalADayRefused(changes)) {
    return { reason: "severalRulesTime" };
  }
  const cost = changedMeetingCost(changes);
  if (cost) {
    return { cost, reason: "changedMeeting" };
  }
  return changes.refused?.scopes.all || refusedAsWholeSeries(changes)
    ? { reason: "refused" }
    : null;
}

/**
 * Whether the server refused This and following from the series' first
 * meeting as it would Entire series: it saves it there as the whole
 * series (`updateEventAll`), so its reasons hold for both, but for
 * meetings added before that first one, which only This and following
 * can't take.
 */
function refusedAsWholeSeries(changes: EventSaveChanges): boolean {
  return Boolean(
    changes.opensSeries &&
      changes.refused?.refusals.some(
        ({ refusal, scope }) =>
          scope === "following" && refusal.reason !== "addedBeforeStart"
      )
  );
}

/**
 * The series scopes the server refused for this save. From the series'
 * first meeting, a refusal for one is for both: This and following there
 * is the entire series (`refusedAsWholeSeries`, `firstMeetingRefused`).
 */
function refusedScopes(changes: EventSaveChanges): {
  all: boolean;
  following: boolean;
} {
  const scopes = changes.refused?.scopes;
  return {
    all: Boolean(scopes?.all) || refusedAsWholeSeries(changes),
    following:
      Boolean(scopes?.following) || Boolean(changes.opensSeries && scopes?.all),
  };
}

/**
 * What loading the series could open past the server's refusals: This and
 * following, and Entire series where it waits for the series (a new
 * repeat or time on the occurrence's own day).
 */
function loadingOpens(changes: EventSaveChanges): {
  all: boolean;
  following: boolean;
} {
  const refused = refusedScopes(changes);
  return {
    all:
      !(refused.all || changes.dateMoved) &&
      Boolean(changes.patternChanged || changes.retimed),
    following: !refused.following,
  };
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
 * From the series' first meeting, "from here" is the series' new start,
 * which the server can refuse too (`firstMeetingNewDayRefusal`). Where
 * This and following is off as well (refused there, or `splitBlock` from
 * the caller, with its reason unless the server's leads the line), the
 * changes apply to the occurrence alone.
 */
function newDayLine(
  changes: EventSaveChanges,
  splitBlock?: { why: string | null }
): string {
  const city = changes.seriesTimeZone
    ? timeZoneCity(changes.seriesTimeZone)
    : null;
  const where = city
    ? `In ${city} time, this occurrence is now on another day than its series`
    : "This occurrence is now on another day than its series";
  const refusal = firstMeetingNewDayRefusal(changes);
  if (refusal || splitBlock) {
    const alone = changes.patternChanged
      ? `${where}, and a new repeat can't apply to it alone.`
      : `${where}, so your changes apply to it alone.`;
    return sentences(
      alone,
      refusal && firstMeetingNewDayLine(refusal),
      splitBlock?.why
    );
  }
  return changes.patternChanged
    ? `${where}, so a new repeat applies from it on.`
    : `${where}, so your changes apply to it, or from it on.`;
}

/** The sentences given, in order, those left out skipped. */
function sentences(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** "Dec 7": a moved meeting's day, as the dialog names it. */
function shortDay(day: Temporal.PlainDate): string {
  return day.toLocaleString("en-US", { day: "numeric", month: "short" });
}

/** Why Entire series is off for a save that would cost a meeting its own. */
function changedMeetingLine({ day, reason }: EntireSeriesCost): string {
  const meeting = shortDay(day);
  switch (reason) {
    case "lostSlot":
      return `The new repeat would undo your changes to the ${meeting} meeting, so it can't apply to the entire series.`;
    case "newStart":
      return `Changing the time for the entire series would reset your changed ${meeting} meeting.`;
    case "ownLength":
      return `Changing the length for the entire series would also change the length you gave the ${meeting} meeting.`;
    default:
      return reason satisfies never;
  }
}

/** The same, for a calendar move, which takes the whole series. */
function changedMeetingMoveLine({ day, reason }: EntireSeriesCost): string {
  const meeting = shortDay(day);
  const move = "Moving to another calendar moves the whole series, but";
  switch (reason) {
    case "lostSlot":
      return `${move} the new repeat would undo your changes to the ${meeting} meeting. Move the calendar and change the repeat in two saves.`;
    case "newStart":
      return `${move} changing its time would reset your changed ${meeting} meeting. Move the calendar and change the time in two saves.`;
    case "ownLength":
      return `${move} changing its length would also change the length you gave the ${meeting} meeting. Move the calendar and change the length in two saves.`;
    default:
      return reason satisfies never;
  }
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
    case "changedMeeting":
      return changedMeetingMoveLine(off.cost);
    case "severalRulesTime":
      return copy.moveEventSeveralRulesTime;
    case "refused":
      return copy.moveEventRefused;
    case "seriesPending":
      // Loading can't open what the server refused.
      if (refusedScopes(changes).all) {
        return copy.moveEventRefused;
      }
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

/**
 * The scope dialog's line while the series' rule loads, or failed to, and
 * what loading would open (`loadingOpens`). Where it can open nothing the
 * server didn't refuse, the line says what's left now instead: the
 * occurrence alone for a new day, no scope for a new repeat
 * (`noScopeStep`), else nothing of its own (the plain prompt follows).
 */
function seriesPendingDescription(changes: EventSaveChanges): string {
  const copy = SCOPE_DIALOG_COPY;
  const opens = loadingOpens(changes);
  if (!(opens.all || opens.following)) {
    if (changes.dateMoved) {
      return newDayLine(changes, { why: null });
    }
    return changes.patternChanged ? copy.repeatNotAlone : "";
  }
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
    return `${newDayLine(changes)} ${loadingLine(opens)}`;
  }
  return loadingLine(opens);
}

/** "Loading the series…", and what opens once it's in (`loadingOpens`). */
function loadingLine(opens: { all: boolean; following: boolean }): string {
  const copy = SCOPE_DIALOG_COPY;
  if (!opens.following) {
    return copy.seriesLoadingAll;
  }
  return opens.all ? copy.seriesLoadingTime : copy.seriesLoading;
}

/**
 * The scope dialog's line where This and following can't start a series:
 * `block`'s reason, or, where the server refused it (`block` null), none,
 * as the server's leads the line.
 */
function splitBlockedDescription(
  changes: EventSaveChanges,
  block: FollowingBlock | null
): string {
  const why = block && SCOPE_DIALOG_COPY.splitBlocked[block];
  const then = SCOPE_DIALOG_COPY.splitBlockedThen;
  const { patternChanged } = changes;
  const off = entireSeriesOff(changes);
  const line = (() => {
    switch (off?.reason) {
      case undefined:
        return sentences(why, patternChanged && then.repeat);
      case "newDay":
        return newDayLine(changes, { why });
      case "repeatDay":
        return sentences(why, then.repeatOffDay);
      case "repeatEnd":
        return sentences(why, then.repeatEndOff);
      case "changedMeeting":
        return sentences(
          why,
          changedMeetingLine(off.cost),
          patternChanged && SCOPE_DIALOG_COPY.repeatNotAlone
        );
      case "refused":
        return sentences(
          why,
          patternChanged && SCOPE_DIALOG_COPY.repeatNotAlone
        );
      case "severalRulesTime":
        return sentences(
          why,
          patternChanged
            ? SCOPE_DIALOG_COPY.severalRulesTimeAndRepeatReason
            : `${SCOPE_DIALOG_COPY.severalRulesTimeReason} ${then.severalRulesTime}`
        );
      case "seriesPending":
        return seriesPendingDescription(changes);
      default:
        return off satisfies never;
    }
  })();
  return line;
}

/**
 * Why Entire series is off (`line`; null where the server's reason leads
 * the dialog), then, with a new repeat, which Only this can't take, where
 * it can go: from this occurrence on, or, from the first meeting, nowhere.
 */
function withRepeatScope(
  changes: EventSaveChanges,
  line: string | null
): string {
  if (!changes.patternChanged) {
    return line ?? "";
  }
  return sentences(
    line,
    firstMeetingRefused(changes)
      ? SCOPE_DIALOG_COPY.repeatNotAlone
      : SCOPE_DIALOG_COPY.repeatFromHere
  );
}

/**
 * Why a series meeting several times a day can't take the new time, and
 * where the save can go: from its first meeting, Only this alone (the
 * first-meeting line follows), else from this occurrence on too; with a
 * new repeat, which Only this can't take, from this occurrence on, or,
 * from the first meeting, nowhere.
 */
function severalRulesTimeLine(changes: EventSaveChanges): string {
  const copy = SCOPE_DIALOG_COPY;
  const first = firstMeetingRefused(changes);
  if (!changes.patternChanged) {
    return first
      ? copy.severalRulesTimeReason
      : `${copy.severalRulesTimeReason} ${copy.newTimeHere}`;
  }
  return first
    ? copy.severalRulesTimeAndRepeatReason
    : `${copy.severalRulesTimeReason} ${copy.repeatFromHere}`;
}

/**
 * The scope dialog's line for a save: the server's reasons for scopes it
 * refused, why each scope the save itself rules out is off, and, where no
 * scope is left, what to do (`noScopeStepFor`). Where the save rules out
 * nothing of its own past the server's refusal, it ends with the plain
 * prompt.
 */
export function eventSaveDescription(changes: EventSaveChanges): string {
  const own = whyScopesOff(changes);
  const step = noScopeStepFor(changes);
  return sentences(
    changes.refused?.message,
    own,
    !(changes.calendarChanged || changes.splitBlocked) &&
      firstMeetingRefused(changes) &&
      SCOPE_DIALOG_COPY.firstMeetingFollowing,
    step ?? (own ? null : SCOPE_DIALOG_COPY.saveEvent.description)
  );
}

/**
 * Why This and following can't start a series here, where the server's
 * refusal, which leads the line, doesn't say it already.
 */
function ownSplitBlock(changes: EventSaveChanges): FollowingBlock | null {
  const block = changes.splitBlocked;
  return block &&
    !changes.refused?.refusals.some(({ refusal }) => refusal.reason === block)
    ? block
    : null;
}

/** Why the save's own changes rule out what they do (`eventSaveDescription`). */
function whyScopesOff(changes: EventSaveChanges): string {
  if (changes.calendarChanged) {
    return calendarMoveDescription(changes);
  }
  if (!followingRuleKnown(changes)) {
    return seriesPendingDescription(changes);
  }
  if (changes.splitBlocked || refusedScopes(changes).following) {
    return splitBlockedDescription(changes, ownSplitBlock(changes));
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
    case "changedMeeting":
      return withRepeatScope(changes, changedMeetingLine(off.cost));
    case "refused":
      return withRepeatScope(changes, null);
    case "severalRulesTime":
      return severalRulesTimeLine(changes);
    case "seriesPending":
      return seriesPendingDescription(changes);
    default:
      return off satisfies never;
  }
}
