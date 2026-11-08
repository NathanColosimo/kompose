import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  addsBeforeStart,
  carryCount,
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
import { meetsSeveralTimesADay } from "@kompose/google-cal/until";
import { ORPCError } from "@orpc/client";
import { Temporal } from "temporal-polyfill";
import {
  type EntireSeriesCost,
  eventTimeZone,
  timeZoneCity,
} from "./google-event-recurrence";

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
  /** A calendar move with a new time for a series meeting several times a day. */
  moveEventSeveralRulesTime:
    "Moving to another calendar moves the whole series, but its meetings keep times of their own, so a new time can't go with it. Move the calendar and change the time in two saves.",
  /** A new time for a series meeting several times a day (the server's words). */
  severalRulesTime: refusalMessage({ reason: "severalTimesADay" }),
  /** After why Entire series is off, from the series' first meeting. */
  firstMeetingFollowing:
    "From its first meeting, This and following is the entire series too.",
  saveEvent: {
    description: "Apply your changes to:",
    title: "Save recurring event",
  },
  /**
   * Why This and following is off for an occurrence, in the words the
   * server refuses it with.
   */
  splitBlocked: {
    addedBeforeStart: refusalMessage({ reason: "addedBeforeStart" }),
    addedOccurrence: refusalMessage({ reason: "addedOccurrence" }),
    countUnknown: refusalMessage({ reason: "countUnknown" }),
    severalRules: refusalMessage({ reason: "severalRules" }),
  } satisfies Record<FollowingBlock, string>,
  /**
   * After `splitBlocked`, for what else the save changes: with This and
   * following off, a new repeat can only go to the entire series, and not
   * with times the series can't take (another day, or a series of several
   * rules), nor where it would skip this occurrence.
   */
  splitBlockedThen: {
    repeat: "A new repeat applies to the entire series.",
    repeatOffDay:
      "Counted from the series' first meeting, the new repeat would skip this occurrence, so change the repeat from that first meeting.",
    repeatEndOff:
      "Counted from the series' first meeting, the new end comes before this occurrence, so change the repeat from that first meeting.",
    severalRulesTime: "A new time applies to this occurrence only.",
    timesAndRepeat: "Change the times and the repeat in two saves.",
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
   * An Entire series save would move the series' start time
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

/** The scopes the server refused for one pending save, and the latest why. */
export interface SaveRefusals {
  /** The latest refusal, in the server's words (`refusalMessage`). */
  message: string;
  scopes: Partial<Record<RecurrenceScope, true>>;
}

/** `refused` with `scope` refused too, for `refusal`. */
export function refuseSave(
  refused: SaveRefusals | null | undefined,
  scope: RecurrenceScope,
  refusal: SeriesRefusal
): SaveRefusals {
  return {
    message: refusalMessage(refusal),
    scopes: { ...refused?.scopes, [scope]: true },
  };
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
  return refused
    ? {
        description: `${refused.message} ${own.description}`,
        disabled: { ...own.disabled, ...refused.scopes },
      }
    : own;
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
  const zone = master.start.timeZone ?? eventTimeZone(occurrence, appTimeZone);
  return sameTime(
    occurrence.originalStartTime ?? occurrence.start,
    master.start,
    zone
  );
}

/**
 * Whether a split can't carry on the series' COUNT, as the server reads
 * it: the save keeps the COUNT, and `carryCount` can't work out what's
 * left. Given no Google listing, that's null only where no listing would
 * settle it (a rule it can't walk, in a series with added days).
 */
function countLeftUnknown(params: {
  masterRecurrence: string[];
  masterStart: { date?: string | null; dateTime?: string | null };
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
  return (
    carryCount(rule, {
      masterRecurrence,
      originalStart,
      seriesStart:
        params.masterStart.dateTime ?? params.masterStart.date ?? originalStart,
      seriesZone,
      starts: [],
    }) === null
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
  const start = master.start.dateTime
    ? Temporal.Instant.from(master.start.dateTime)
        .toZonedDateTimeISO(zone)
        .toPlainTime()
    : null;
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
    !firstMeetingRefused(changes);
  return {
    ...(changes.patternChanged ? { this: true } : {}),
    ...(allOff ? { all: true } : {}),
    ...(followingOn ? {} : { following: true }),
  };
}

/**
 * Whether This and following from the series' first meeting is refused
 * as Entire series is: the server saves it as the whole series. A new day
 * isn't one of those reasons (through its first meeting the series moves).
 */
function firstMeetingRefused(changes: EventSaveChanges): boolean {
  const off = entireSeriesOff(changes);
  return Boolean(changes.opensSeries && off && off.reason !== "newDay");
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
 * new repeat or time waits for it ("seriesPending").
 */
function entireSeriesOff(changes: EventSaveChanges): EntireSeriesOff | null {
  const { patternChanged, repeatSkips, retimed } = changes;
  const cost =
    changes.entireSeriesCost ??
    (patternChanged && changes.droppedMovedDay
      ? { day: changes.droppedMovedDay, reason: "lostSlot" as const }
      : null);
  if (changes.dateMoved) {
    return { reason: "newDay" };
  }
  if ((patternChanged || retimed) && !changes.seriesRuleLoaded) {
    return { reason: "seriesPending" };
  }
  if (patternChanged && repeatSkips) {
    return { reason: repeatSkips === "day" ? "repeatDay" : "repeatEnd" };
  }
  if (retimed && changes.severalRules) {
    return { reason: "severalRulesTime" };
  }
  return cost ? { cost, reason: "changedMeeting" } : null;
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
  block: FollowingBlock
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
        ? `${why} ${then.timesAndRepeat}`
        : `${newDayLine(changes)} ${why}`;
    case "repeatDay":
      return `${why} ${then.repeatOffDay}`;
    case "repeatEnd":
      return `${why} ${then.repeatEndOff}`;
    case "changedMeeting":
      return `${why} ${changedMeetingLine(off.cost)}`;
    case "severalRulesTime":
      return patternChanged
        ? `${why} ${then.timesAndRepeat}`
        : `${why} ${then.severalRulesTime}`;
    case "seriesPending":
      return seriesPendingDescription(changes);
    default:
      return off satisfies never;
  }
}

/** The scope dialog's line for a save: why each scope that's off is. */
export function eventSaveDescription(changes: EventSaveChanges): string {
  const own = whyScopesOff(changes);
  const line =
    !(changes.calendarChanged || changes.splitBlocked) &&
    firstMeetingRefused(changes)
      ? `${own} ${SCOPE_DIALOG_COPY.firstMeetingFollowing}`
      : own;
  return changes.refused ? `${changes.refused.message} ${line}` : line;
}

/** Why the save's own changes rule out what they do (`eventSaveDescription`). */
function whyScopesOff(changes: EventSaveChanges): string {
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
    case "changedMeeting":
      return changedMeetingLine(off.cost);
    case "severalRulesTime":
      return SCOPE_DIALOG_COPY.severalRulesTime;
    case "seriesPending":
      return seriesPendingDescription(changes);
    default:
      return off satisfies never;
  }
}
