import { Context, Effect, Exit, Layer, Schedule, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  APIConnectionError,
  APIError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
} from "./api-client/core/error";
import {
  addsSlot,
  countLeft,
  countOf,
  endsBeforeStart,
  followingIsWhole,
  followingSplitBlocked,
  repeats,
  sanitizeEventPayload,
  seriesMeetsAt,
  skipKey,
  skipping,
  splitAddedDays,
  truncateRecurrenceForFollowing,
  withCount,
} from "./recurrence-utils";
import {
  type Calendar,
  CalendarSchema,
  type Colors,
  ColorsSchema,
  type CreateCalendar,
  type CreateEvent,
  type Event,
  EventSchema,
  type RecurrenceScope,
} from "./schema";
import { meetsSeveralTimesADay, ruleDayCount, ruleMeetings } from "./series";
import {
  canonicalRule,
  changedFields,
  keepsTimes,
  type NamingRefusal,
  newRepeat,
  ownChanges,
  placeInNewSeries,
  refusalMessage,
  type SeriesRefusal,
  SeriesRefusalSchema,
  sameLength,
  sameTime,
  seriesAttendees,
} from "./series-edits";
import {
  seriesSlotAt,
  seriesTimesForEdit,
  seriesZoneOf,
  slotOf,
} from "./series-times";
import {
  clockOf,
  DATE_ONLY,
  dateValues,
  dayOfStart,
  googleDateTime,
  keepingDateValues,
  lengthMs,
  momentOf,
  type RecurrenceValue,
  readRecurrenceValue,
  startInstant,
} from "./until";

/** A rule part that ends it: COUNT or UNTIL. */
const END_PART = /^(?:COUNT|UNTIL)=/;

/** A rule line without its end (COUNT, UNTIL). */
function withoutEnd(line: string): string {
  const [name, parts = ""] = line.split(":");
  return `${name}:${parts
    .split(";")
    .filter((part) => !END_PART.test(part))
    .join(";")}`;
}

/**
 * `recurrence` as what it means, however it's written: its rules' parts,
 * and its skipped and added moments.
 */
function recurrenceValues(recurrence: string[], zone: string): string {
  const rules = recurrence
    .filter((line) => line.startsWith("RRULE:") || line.startsWith("EXRULE:"))
    .map(canonicalRule)
    .sort();
  const values = (name: "EXDATE" | "RDATE") =>
    dateValues(recurrence, name, zone).map(skipKey).sort();
  return JSON.stringify([rules, values("EXDATE"), values("RDATE")]);
}

interface GoogleWatchChannelInput {
  address: string;
  expiration: string;
  id: string;
  token: string;
}

interface GoogleWatchChannelResult {
  channelId: string;
  expiration?: string;
  resourceId: string;
}

/**
 * The start's time of day before and after an edit to `start`, when both
 * are timed and it changes; null otherwise.
 */
function timeOfDayChange(
  master: Event,
  start: Event["start"]
): { from: Temporal.PlainTime; to: Temporal.PlainTime } | null {
  const zone = seriesZoneOf(master);
  const from = clockOf(master.start, zone);
  const to = clockOf(start, zone);
  return from && to && Temporal.PlainTime.compare(from, to) !== 0
    ? { from, to }
    : null;
}

/**
 * A refusal naming the occurrences (by original start, earliest first) a
 * save would cost, marked when the save is one only a series takes.
 */
function naming(
  reason: NamingRefusal["reason"],
  originalStarts: readonly string[],
  seriesOnly: boolean
): NamingRefusal {
  const named = {
    originalStarts: originalStarts.toSorted(
      (a, b) => Date.parse(a) - Date.parse(b)
    ),
    reason,
  };
  return seriesOnly ? { ...named, seriesOnly: true } : named;
}

/**
 * `refusal` marked `unsure` when the series has an exclusion rule (EXRULE),
 * which isn't read here: what it names may keep its changes, but that
 * can't be told.
 */
function unsureWhere(
  refusal: NamingRefusal,
  recurrence: string[]
): NamingRefusal {
  return recurrence.some((line) => line.startsWith("EXRULE"))
    ? { ...refusal, unsure: true }
    : refusal;
}

/**
 * Whether the save's rules (`saved`) give `master` a new repeat, which one
 * occurrence can't take. Moving the first meeting (`from`) to another day
 * moves the series' days with it.
 */
function givesNewRepeat(params: {
  from: Event["start"];
  master: Event;
  saved: string[] | undefined;
  start: Event["start"];
}): boolean {
  const zone = seriesZoneOf(params.master);
  const day = newStartDay(params.master, params.start);
  const from = dayOfStart(params.from, zone);
  return newRepeat({
    moved: day && from && !from.equals(day) ? { from, to: day } : null,
    own: params.master.recurrence ?? [],
    saved: params.saved,
  });
}

/**
 * A new start's day where the series will repeat (an all-day series made
 * timed, in the new start's zone): what a day move is read from.
 */
function newStartDay(
  master: Pick<Event, "start">,
  start: Event["start"]
): Temporal.PlainDate | null {
  return dayOfStart(start, repeatZone(master, start));
}

/** A slot as a start: a date, or a date-time. */
function asStart(slot: string): Event["start"] {
  return DATE_ONLY.test(slot) ? { date: slot } : { dateTime: slot };
}

/** A meeting the library gives back, as a slot written in `zone`. */
function slotString(
  meeting: Temporal.Instant | Temporal.PlainDate,
  zone: string
): string {
  return meeting instanceof Temporal.Instant
    ? googleDateTime(meeting.toZonedDateTimeISO(zone))
    : meeting.toString();
}

/** A recurrence's rules (RRULE lines). */
function rulesOf(recurrence: string[]): string[] {
  return recurrence.filter((line) => line.startsWith("RRULE:"));
}

/** A refusal, as the service fails with it. */
function refused(refusal: SeriesRefusal): GoogleApiError {
  return new GoogleApiError({
    cause: new Error(refusalMessage(refusal)),
    refusal,
  });
}

/**
 * Whether `occurrence` is its series' first meeting: the master, or the
 * occurrence at its start (not an added meeting before it).
 */
function opensSeries(occurrence: Event, master: Event): boolean {
  if (!occurrence.recurringEventId) {
    return true;
  }
  const zone = seriesZoneOf(master);
  const original = momentOf(
    occurrence.originalStartTime ?? occurrence.start,
    zone
  );
  const first = momentOf(master.start, zone);
  return Boolean(
    original && first && Temporal.Instant.compare(original, first) === 0
  );
}

/**
 * The zone a series repeats in once `start` is written: its own, or, for
 * an all-day series made timed, the new start's.
 */
function repeatZone(
  master: { start: { timeZone?: string } },
  start: { timeZone?: string }
): string {
  return master.start.timeZone ?? start.timeZone ?? "UTC";
}

/**
 * `time` as the same moment in the series' zone, if it has one. A
 * date-time without an offset is read in its own zone, as Google does.
 */
function inSeriesZone<
  T extends { date?: string; dateTime?: string; timeZone?: string },
>(time: T, series: { timeZone?: string }): T {
  if (!(time.dateTime && series.timeZone)) {
    return time;
  }
  const moment = startInstant(time, series.timeZone);
  const dateTime = moment
    ? googleDateTime(moment.toZonedDateTimeISO(series.timeZone))
    : time.dateTime;
  return { ...time, dateTime, timeZone: series.timeZone };
}

/** An occurrence's original start: the slot it holds in its series. */
function originalStartOf(occurrence: Event, zone: string): string | null {
  return slotOf(occurrence.originalStartTime ?? occurrence.start, zone);
}

/**
 * `master`'s times from its own start with `edited`'s length (or span of
 * days, all day); null when the forms differ or a time doesn't parse.
 */
function withLength(
  master: Event,
  edited: Pick<CreateEvent, "end" | "start">
): { end: Event["end"]; start: Event["start"] } | null {
  const zone = seriesZoneOf(master);
  if (master.start.date && edited.start.date && edited.end.date) {
    const days = Temporal.PlainDate.from(edited.start.date).until(
      edited.end.date
    ).days;
    return {
      end: {
        date: Temporal.PlainDate.from(master.start.date)
          .add({ days: Math.max(1, days) })
          .toString(),
      },
      start: master.start,
    };
  }
  const from = startInstant(master.start, zone);
  const length = lengthMs(edited.start, edited.end, zone);
  if (!(from && length !== null) || edited.start.date) {
    return null;
  }
  return {
    end: {
      dateTime: googleDateTime(
        from.add({ milliseconds: length }).toZonedDateTimeISO(zone)
      ),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: master.start,
  };
}

/**
 * A series' times after an "Entire series" edit through `occurrence`.
 * Times the edit left keep the series' (an occurrence moved on its own
 * doesn't move it), and a new end alone changes only the length. Only an
 * edit to the first meeting moves the series' date, and only to a day its
 * rules are known to meet on: Google always meets at a series' start, so
 * any other day would add a meeting the rules don't make. Elsewhere a date
 * move is "This and following" only. Google repeats a series in its
 * start's zone, so times are read in it.
 */
function entireSeriesTimes(params: {
  edited: CreateEvent;
  master: Event;
  occurrence: Event;
}): { end: Event["end"]; start: Event["start"] } {
  const { edited, master, occurrence } = params;
  const zone = seriesZoneOf(master);
  const kept = { end: master.end, start: master.start };
  if (keepsTimes(edited, occurrence, zone)) {
    return kept;
  }
  if (sameTime(edited.start, occurrence.start, zone)) {
    return withLength(master, edited) ?? kept;
  }
  const end = inSeriesZone(edited.end, master.end);
  const start = inSeriesZone(edited.start, master.start);
  const rules = rulesOf(edited.recurrence ?? master.recurrence ?? []);
  const day = newStartDay(master, start);
  const rulesMeet =
    !day ||
    rules.length === 0 ||
    rules.some(
      (rule) => (ruleDayCount({ from: day, rule, through: day }) ?? 0) > 0
    );
  // A day the opened meeting already had on its own isn't a new one.
  const movesDay = !day?.equals(dayOfStart(occurrence.start, zone) ?? day);
  if (opensSeries(occurrence, master) && rulesMeet && movesDay) {
    return { end, start };
  }
  return (
    seriesTimesForEdit({
      editedEnd: end,
      editedStart: start,
      masterEnd: master.end,
      masterStart: master.start,
    }) ?? kept
  );
}

/**
 * An Entire series edit's times on the opened occurrence's own day (the
 * series keeps its dates). A time the edit kept is the occurrence's own,
 * moment for moment (rebuilt from its clock, a time in an hour a clock
 * change repeats could move). Its own times if they don't parse.
 */
function timesOnOwnDay(params: {
  edited: CreateEvent;
  master: Event;
  occurrence: Event;
}): { end: Event["end"]; start: Event["start"] } {
  const { edited, master, occurrence } = params;
  const zone = seriesZoneOf(master);
  if (sameTime(edited.start, occurrence.start, zone)) {
    return {
      end: sameTime(edited.end, occurrence.end, zone)
        ? occurrence.end
        : inSeriesZone(edited.end, master.end),
      start: occurrence.start,
    };
  }
  return (
    seriesTimesForEdit({
      editedEnd: inSeriesZone(edited.end, master.end),
      editedStart: inSeriesZone(edited.start, master.start),
      masterEnd: occurrence.end,
      masterStart: inSeriesZone(occurrence.start, master.start),
    }) ?? { end: occurrence.end, start: occurrence.start }
  );
}

/**
 * A rule a save sends with the series' skips it leaves out: a client that
 * rebuilds the rule may send it alone. A day the rule skips whole (a date)
 * already covers that day's skips.
 */
function withSeriesSkips(rule: string[], master: Event): string[] {
  const zone = seriesZoneOf(master);
  const skippedDays = new Set(
    dateValues(rule, "EXDATE", zone)
      .filter((value) => value.instant === null)
      .map((value) => value.day.toString())
  );
  return skipping(
    rule,
    dateValues(master.recurrence ?? [], "EXDATE", zone)
      .filter((value) => !skippedDays.has(value.day.toString()))
      .map((value) => slotString(value.instant ?? value.day, zone)),
    zone
  );
}

/**
 * `edited` with its times in one form. A form keeps the other form's field
 * beside the new one, so when both are sent the one the opened occurrence
 * didn't have is the user's choice.
 */
function withOneForm(edited: CreateEvent, occurrence: Event): CreateEvent {
  const pick = (time: Event["start"]): Event["start"] => {
    if (!(time.date && time.dateTime)) {
      return time;
    }
    return occurrence.start.date
      ? { dateTime: time.dateTime, timeZone: time.timeZone }
      : { date: time.date };
  };
  return { ...edited, end: pick(edited.end), start: pick(edited.start) };
}

/** Whether the series' own rules (not an added day) meet at `slot`. */
function ruleMeetingAt(slot: string, master: Event): boolean {
  return (
    seriesMeetsAt({
      recurrence: rulesOf(master.recurrence ?? []),
      seriesZone: seriesZoneOf(master),
      slot,
      start: master.start,
    }) === true
  );
}

/**
 * Where an occurrence's place (`slot`, its original start) is once the
 * series is written as `plan` says: its own day at the new time, or its
 * date when the series is made all day (a series that meets once a day).
 * Null if it doesn't parse.
 */
function placeIn(slot: string, plan: SeriesPlan): string | null {
  const { master, times } = plan;
  const day = dayOfStart(asStart(slot), seriesZoneOf(master));
  const repeatsIn = repeatZone(master, times.start);
  const clock = clockOf(times.start, repeatsIn);
  if (!day) {
    return null;
  }
  return clock
    ? googleDateTime(
        day.toZonedDateTime({ plainTime: clock, timeZone: repeatsIn })
      )
    : day.toString();
}

/**
 * What an Entire series save that ends the repeat ("Repeat: None") keeps:
 * the series becomes its first meeting alone, and Google drops every
 * occurrence's own changes with the repeat. The first meeting's own
 * fields the save doesn't set, and its own times when the save keeps the
 * series' times (or it's the one opened, whose times the form shows), are
 * carried into the event left (`carried`). Any other changed occurrence,
 * a first meeting deleted on its own or skipped in the rule (or maybe
 * dropped by an exclusion rule), or own times the save changes, is
 * `lost`.
 */
function endedRepeat(params: {
  cancelled: string[];
  changed: { occurrence: Event; originalStart: string }[];
  plan: SeriesPlan;
}): { carried: Partial<CreateEvent>; lost: string[] } {
  const { changes, edited, master, opened, times } = params.plan;
  const zone = seriesZoneOf(master);
  const firstSlot = slotOf(master.start, zone);
  const first = momentOf(master.start, zone);
  const skipped = dateValues(master.recurrence ?? [], "EXDATE", zone).some(
    (value) =>
      value.instant && first
        ? Temporal.Instant.compare(value.instant, first) === 0
        : value.day.toString() === master.start.date
  );
  // An exclusion rule isn't read here: it may drop the first meeting.
  const excluded = (master.recurrence ?? []).some((line) =>
    line.startsWith("EXRULE")
  );
  const lost = params.cancelled.filter((slot) => slot === firstSlot);
  if ((skipped || excluded) && firstSlot && !lost.includes(firstSlot)) {
    lost.push(firstSlot);
  }
  let carried: Partial<CreateEvent> = {};
  for (const { occurrence, originalStart } of params.changed) {
    if (originalStart !== firstSlot) {
      lost.push(originalStart);
      continue;
    }
    const { end, start, ...own } = changesOwnTo(occurrence, master, zone);
    const fields = Object.fromEntries(
      Object.entries(own).filter(([field]) => !(field in changes))
    );
    if (occurrence.id === opened.id) {
      carried = {
        ...fields,
        end: inSeriesZone(edited.end, master.end),
        start: inSeriesZone(edited.start, master.start),
      };
    } else if (!(start && end)) {
      carried = fields;
    } else if (
      // The save leaves the series' times, or gives its own length.
      sameTime(times.start, master.start, zone) &&
      (sameLength(times, master, zone) || sameLength(occurrence, times, zone))
    ) {
      carried = { ...fields, end, start };
    } else {
      lost.push(originalStart);
    }
  }
  return { carried, lost };
}

/**
 * `rule` without a skip at the series' new start, moved to another day,
 * that the save didn't add (in the rules it sends): one the series had
 * there, or one placed there for a deleted meeting, was another meeting's
 * (a Wednesday deleted, the first Monday moved onto it), and the meeting
 * just placed there stays. A skip the save adds there is the user's; on
 * the start's own day, a skip there is the first meeting's.
 */
function withoutOwnSkipAt(rule: string[], plan: SeriesPlan): string[] {
  const { master } = plan;
  const { start } = plan.times;
  const zone = seriesZoneOf(master);
  const day = newStartDay(master, start);
  if (!day || day.equals(dayOfStart(master.start, zone) ?? day)) {
    return rule;
  }
  const at = momentOf(start, repeatZone(master, start));
  const onStart = (value: RecurrenceValue) =>
    value.instant
      ? Boolean(at && Temporal.Instant.compare(value.instant, at) === 0)
      : value.day.toString() === start.date;
  const added =
    dateValues(plan.edited.recurrence ?? [], "EXDATE", zone).some(onStart) &&
    !dateValues(master.recurrence ?? [], "EXDATE", zone).some(onStart);
  return added
    ? rule
    : keepingDateValues(rule, "EXDATE", zone, (value) => !onStart(value));
}

/** An Entire series save, worked out once from the edit. */
interface SeriesPlan {
  /** The fields the edit changed, as the series is written with them. */
  changes: Partial<CreateEvent>;
  /** The form as sent, for what the opened occurrence was given. */
  edited: CreateEvent;
  master: Event;
  /** The start or the rules move, so an occurrence's slot may go. */
  movesSlots: boolean;
  /** The start moves: Google cancels every occurrence's own changes. */
  movesStart: boolean;
  opened: Event;
  /** The rules written; skips for deleted occurrences come in `afterSave`. */
  recurrence: string[];
  /** Only a whole series takes the save: a new repeat. */
  seriesOnly: boolean;
  times: { end: Event["end"]; start: Event["start"] };
}

/**
 * An occurrence with something of its own: changed, deleted on its own,
 * or skipped in the rule (EXDATE) and sent as it was by a save that moves
 * the first meeting's day.
 */
type SeriesException =
  | { kind: "changed"; occurrence: Event; originalStart: string }
  | { kind: "deleted"; originalStart: string }
  | { kind: "ruleSkip"; originalStart: string };

/** What a save does to an occurrence's own changes or deletion. */
type Fate =
  /** Google keeps it as it is. */
  | { kind: "kept" }
  /** The new meeting in its place has all it changed. */
  | { kind: "replaced" }
  /** A deleted one, skipped again where its meeting now is. */
  | { kind: "skip"; at: string }
  /** What it changed, or its deletion, would be undone. */
  | { kind: "lost" }
  /** A new length would overwrite its own. */
  | { kind: "resized" };

/** Whether the series written as `plan` meets at `slot`. */
function plannedMeetsAt(slot: string, plan: SeriesPlan): boolean {
  return (
    seriesMeetsAt({
      recurrence: plan.recurrence,
      seriesZone: repeatZone(plan.master, plan.times.start),
      slot,
      start: plan.times.start,
    }) === true
  );
}

/**
 * Whether a rule meeting deleted or skipped at `slot` would come back: its
 * place after the new start isn't one of the written rules' meetings (read
 * without their end, as one past it goes with the rest), so the meeting
 * now there in its stead isn't skipped (a first meeting moved under a rule
 * whose days follow its start, say). A new repeat places every meeting
 * anew, so nothing of the old one comes back.
 */
function comesBack(slot: string, plan: SeriesPlan): boolean {
  const { master, times } = plan;
  const repeatsIn = repeatZone(master, times.start);
  const place = ruleMeetingAt(slot, master) ? placeIn(slot, plan) : null;
  const at = place && momentOf(asStart(place), repeatsIn);
  const first = momentOf(times.start, repeatsIn);
  // Before the new start, the series has no meeting to bring back.
  if (
    plan.seriesOnly ||
    !(place && at && first) ||
    Temporal.Instant.compare(at, first) < 0
  ) {
    return false;
  }
  return (
    seriesMeetsAt({
      recurrence: rulesOf(plan.recurrence).map(withoutEnd),
      seriesZone: repeatsIn,
      slot: place,
      start: times.start,
    }) !== true
  );
}

/**
 * The fields `occurrence` changed on its own that the new meeting in its
 * place (`place`) must have for nothing to be lost. The opened one's own
 * times are the edit's; its own day isn't, as Google gives it back to the
 * series (null), unless it's the first meeting and the series takes its
 * day. Another's times are at stake only if it was moved off its slot (or
 * given its own length): one at its slot follows the series to the new
 * time, and one moved to the new meeting's start at the series' length
 * keeps its start there, its length the series' to change.
 */
function ownAtStake(params: {
  occurrence: Event;
  originalStart: string;
  place: string;
  plan: SeriesPlan;
}): string[] | null {
  const { occurrence, originalStart, place, plan } = params;
  const { master, times } = plan;
  const seriesZone = seriesZoneOf(master);
  const repeatsIn = repeatZone(master, times.start);
  if (occurrence.id === plan.opened.id) {
    const ownDay = dayOfStart(occurrence.start, seriesZone);
    const newDay = newStartDay(master, times.start);
    const firstDayKept =
      opensSeries(occurrence, master) &&
      (ownDay?.equals(newDay ?? ownDay) ||
        !newDay?.equals(dayOfStart(master.start, seriesZone) ?? newDay));
    const movedDay = !(
      firstDayKept ||
      ownDay?.equals(dayOfStart(asStart(originalStart), seriesZone) ?? ownDay)
    );
    return movedDay
      ? null
      : Object.keys(changesOwnTo(occurrence, master, seriesZone)).filter(
          (field) => field !== "start" && field !== "end"
        );
  }
  const meeting = seriesSlotAt(times, place);
  const timesAtStake =
    "start" in changesOwnTo(occurrence, master, seriesZone) &&
    !(
      sameLength(occurrence, master, seriesZone) &&
      sameTime(occurrence.start, meeting.start, repeatsIn)
    );
  return Object.keys(ownChanges(occurrence, master, meeting, repeatsIn)).filter(
    (field) => timesAtStake || !(field === "start" || field === "end")
  );
}

/**
 * What an Entire series save (`plan`) does to `exception`. Google ties
 * each to its original slot: a new start cancels every changed one (the
 * new meeting in its place keeps what the save gives it) and brings back
 * every deleted one (skipped again at its place); a rule without its slot
 * drops it; a new length overwrites a length of its own.
 */
function fateOf(exception: SeriesException, plan: SeriesPlan): Fate {
  switch (exception.kind) {
    case "changed":
      return changedFate(exception.occurrence, exception.originalStart, plan);
    case "deleted":
      return deletedFate(exception.originalStart, plan);
    case "ruleSkip":
      return comesBack(exception.originalStart, plan)
        ? { kind: "lost" }
        : { kind: "kept" };
    default:
      return exception satisfies never;
  }
}

/** A deleted occurrence's fate (`fateOf`). */
function deletedFate(slot: string, plan: SeriesPlan): Fate {
  const { master, times } = plan;
  if (!plan.movesStart) {
    return { kind: "kept" };
  }
  if (comesBack(slot, plan)) {
    return { kind: "lost" };
  }
  // An added (RDATE) meeting's skip stays where it was, unless the series
  // changes form.
  const keepsForm = Boolean(master.start.date) === Boolean(times.start.date);
  const moves = ruleMeetingAt(slot, master) || !keepsForm;
  return { at: (moves && placeIn(slot, plan)) || slot, kind: "skip" };
}

/** A changed occurrence's fate (`fateOf`). */
function changedFate(
  occurrence: Event,
  originalStart: string,
  plan: SeriesPlan
): Fate {
  const { master, times } = plan;
  const seriesZone = seriesZoneOf(master);
  const opened = occurrence.id === plan.opened.id;
  // A length of its own the new length overwrites (the opened one takes
  // the edit's, and one that already has it loses nothing).
  const resized = !(
    opened ||
    sameLength(times, master, seriesZone) ||
    sameLength(occurrence, master, seriesZone) ||
    sameLength(occurrence, times, seriesZone)
  );
  const unlessResized = (fate: Fate): Fate =>
    resized ? { kind: "resized" } : fate;
  if (!plan.movesStart) {
    return plan.movesSlots && !plannedMeetsAt(originalStart, plan)
      ? { kind: "lost" }
      : unlessResized({ kind: "kept" });
  }
  // The first meeting's place is the new start.
  const place =
    opened && opensSeries(occurrence, master)
      ? slotOf(times.start, repeatZone(master, times.start))
      : placeIn(originalStart, plan);
  const own =
    place && plannedMeetsAt(place, plan)
      ? ownAtStake({ occurrence, originalStart, place, plan })
      : null;
  // A value the save gives the whole series (a cleared one too) is the new
  // meeting's too; for the opened one, as the form showed it.
  const shown = opened
    ? ({ ...occurrence, ...plan.edited } as Event)
    : occurrence;
  const kept = own?.every(
    (field) =>
      Object.hasOwn(plan.changes, field) &&
      Object.keys(
        changedFields(
          // Object.keys loses the key type: each is a CreateEvent field.
          { [field]: plan.changes[field as keyof CreateEvent] },
          shown
        )
      ).length === 0
  );
  return kept ? unlessResized({ kind: "replaced" }) : { kind: "lost" };
}

/** The refusal a fate asks for, if any. */
function refusalFor(
  fate: Fate
): "dropsChangedOccurrences" | "resizesChangedOccurrences" | null {
  switch (fate.kind) {
    case "lost":
      return "dropsChangedOccurrences";
    case "resized":
      return "resizesChangedOccurrences";
    case "kept":
    case "replaced":
    case "skip":
      return null;
    default:
      return fate satisfies never;
  }
}

/**
 * The rule meetings skipped in the rule (EXDATE) that a save moving the
 * first meeting's day sends as they were: they stay where they are, so a
 * meeting moved into one's place may come back (`comesBack`).
 */
function ruleSkipsKept(plan: SeriesPlan): SeriesException[] {
  const { master, times } = plan;
  const zone = seriesZoneOf(master);
  const own = master.recurrence ?? [];
  const day = newStartDay(master, times.start);
  if (day?.equals(dayOfStart(master.start, zone) ?? day)) {
    return [];
  }
  const sent = new Set(
    dateValues(plan.edited.recurrence ?? own, "EXDATE", zone).map(skipKey)
  );
  return dateValues(own, "EXDATE", zone)
    .filter((value) => sent.has(skipKey(value)))
    .map((value) => ({
      kind: "ruleSkip",
      originalStart: slotString(value.instant ?? value.day, zone),
    }));
}

/**
 * What an Entire series save writes once each occurrence changed or
 * deleted on its own has its fate (`fateOf`): the rules with a deleted
 * one's skip at its new place, or a refusal naming those it would lose
 * or resize. A save that ends the repeat ("Repeat: None") carries the
 * first meeting's own changes into the event left (`endedRepeat`).
 */
function afterSave(params: {
  cancelled: string[];
  changed: { occurrence: Event; originalStart: string }[];
  plan: SeriesPlan;
}): SeriesRefusal | { carried: Partial<CreateEvent>; recurrence: string[] } {
  const { cancelled, changed, plan } = params;
  const own = plan.master.recurrence ?? [];
  if (!repeats(plan.recurrence)) {
    const { carried, lost } = endedRepeat(params);
    return lost.length > 0
      ? unsureWhere(naming("dropsChangedOccurrences", lost, true), own)
      : { carried, recurrence: [] };
  }
  const deleted: SeriesException[] = [
    ...cancelled.map(
      (originalStart): SeriesException => ({ kind: "deleted", originalStart })
    ),
    ...ruleSkipsKept(plan),
  ];
  // Deleted ones first: their skips are part of what the changed ones are
  // read against.
  const deletedFates = deleted.map((exception) => ({
    exception,
    fate: fateOf(exception, plan),
  }));
  const skips = deletedFates.flatMap(({ fate }) =>
    fate.kind === "skip" ? [fate.at] : []
  );
  const recurrence = plan.movesStart
    ? withoutOwnSkipAt(
        skipping(plan.recurrence, skips, seriesZoneOf(plan.master)),
        plan
      )
    : plan.recurrence;
  const written = { ...plan, recurrence };
  const fates = [
    ...changed.map(({ occurrence, originalStart }) => {
      const exception: SeriesException = {
        kind: "changed",
        occurrence,
        originalStart,
      };
      return { exception, fate: fateOf(exception, written) };
    }),
    ...deletedFates,
  ];
  const named = (reason: ReturnType<typeof refusalFor>) => [
    ...new Set(
      fates
        .filter(({ fate }) => refusalFor(fate) === reason)
        .map(({ exception }) => exception.originalStart)
    ),
  ];
  const lost = named("dropsChangedOccurrences");
  if (lost.length > 0) {
    return unsureWhere(
      naming("dropsChangedOccurrences", lost, plan.seriesOnly),
      [...own, ...recurrence]
    );
  }
  const resized = named("resizesChangedOccurrences");
  return resized.length > 0
    ? naming("resizesChangedOccurrences", resized, plan.seriesOnly)
    : { carried: {}, recurrence };
}

/**
 * Whether an Entire series edit through `occurrence` gives a series that
 * meets several times a day a new time of day: the series' start's, or
 * the opened meeting's own (a 15:00 meeting moved, its start's 9:00 kept).
 * Such a time can't move without moving one time onto another, or off its
 * own.
 */
function movesSeveralADay(params: {
  edited: CreateEvent;
  master: Event;
  occurrence: Event;
  start: Event["start"];
}): boolean {
  const { edited, master, occurrence, start } = params;
  const zone = seriesZoneOf(master);
  const first = startInstant(master.start, zone)?.toZonedDateTimeISO(zone);
  const was = clockOf(occurrence.start, zone);
  const now = clockOf(edited.start, zone);
  // Made all day, its times go too.
  const moves =
    timeOfDayChange(master, start) !== null ||
    Boolean(start.date) ||
    Boolean(was && now && !was.equals(now));
  return Boolean(
    first && moves && meetsSeveralTimesADay(master.recurrence ?? [], first)
  );
}

/**
 * `master`'s exceptions in Google's listing, all or those after `after`
 * (an original start): the cancelled ones' original starts, and the moved
 * or edited ones the series still meets in the place of (one Google
 * detached, its slot gone, has no changes at stake; one an exclusion rule
 * may have dropped counts).
 */
function sortExceptions(
  events: SeriesListing[],
  master: Event,
  after?: string
) {
  const zone = seriesZoneOf(master);
  const from = after ? slotMoment(after, zone) : null;
  const cancelled: string[] = [];
  const changed: { occurrence: Event; originalStart: string }[] = [];
  for (const event of events) {
    const originalStart =
      event.recurringEventId === master.id && event.originalStartTime
        ? slotOf(event.originalStartTime, zone)
        : null;
    const moment = originalStart && slotMoment(originalStart, zone);
    if (
      !(originalStart && moment) ||
      (from && Temporal.Instant.compare(moment, from) <= 0)
    ) {
      continue;
    }
    if (event.status === "cancelled" || !("start" in event)) {
      cancelled.push(originalStart);
    } else if (
      seriesMeetsAt({
        recurrence: master.recurrence ?? [],
        seriesZone: zone,
        slot: originalStart,
        start: master.start,
      }) !== false &&
      // One moved and moved back has nothing to keep.
      Object.keys(changesOwnTo(event, master, zone)).length > 0
    ) {
      changed.push({ occurrence: event, originalStart });
    }
  }
  return { cancelled, changed };
}

/**
 * A cancelled occurrence as Google lists it: only its ids and original
 * start are certain.
 */
const CancelledOccurrenceSchema = z.object({
  id: z.string(),
  originalStartTime: EventSchema.shape.originalStartTime,
  recurringEventId: z.string().optional(),
  status: z.literal("cancelled"),
});

/** A series' master and its exceptions, as listed by iCalUID. */
const SeriesListingSchema = z.array(
  z.union([CancelledOccurrenceSchema, EventSchema])
);
type SeriesListing = z.infer<typeof SeriesListingSchema>[number];

/**
 * `occurrence`'s own changes (see `ownChanges`), from its original start,
 * less the fields `edited` sets for its whole series, which the series
 * carries.
 */
function changesOwnTo(
  occurrence: Event,
  master: Event,
  zone: string,
  edited: Partial<CreateEvent> = {}
): Partial<CreateEvent> {
  const originalStart = originalStartOf(occurrence, zone);
  // A slot in the other form (a date in a timed series) isn't one of the
  // series' meetings: Google detached it, so nothing of it is at stake.
  if (
    !originalStart ||
    DATE_ONLY.test(originalStart) !== Boolean(master.start.date)
  ) {
    return {};
  }
  const own = ownChanges(
    occurrence,
    master,
    seriesSlotAt(master, originalStart),
    zone
  );
  return Object.fromEntries(
    Object.entries(own).filter(([field]) => !(field in edited))
  );
}

// -- This and following --

/**
 * Whether a failed Google write may still have gone through: Google never
 * answered it (a timeout, a dropped connection), or answered with a server
 * error.
 */
function mayGoThrough(error: GoogleApiError): boolean {
  return (
    error.cause instanceof APIConnectionError ||
    error.cause instanceof InternalServerError
  );
}

/** Google's reasons for turning a request away for now (as a 403). */
const RATE_LIMITED = /"(?:userR|r)ateLimitExceeded"/;

/**
 * Whether Google turned a write away for now: a rate limit (a 429, or a
 * 403 that names one) or a request timeout.
 */
function turnedAwayForNow(error: GoogleApiError): boolean {
  const { cause } = error;
  if (cause instanceof RateLimitError) {
    return true;
  }
  if (!(cause instanceof APIError)) {
    return false;
  }
  return (
    cause.status === 408 ||
    (cause.status === 403 && RATE_LIMITED.test(JSON.stringify(cause.error)))
  );
}

/**
 * A split's writes tried again, after a growing wait, on a failure that
 * may clear: one that may still have gone through, or one Google turned
 * away for now.
 */
const WRITE_RETRIES = {
  schedule: Schedule.exponential("200 millis"),
  times: 2,
  while: (error: GoogleApiError) =>
    mayGoThrough(error) || turnedAwayForNow(error),
};

/**
 * Refuses "This and following" where a new series can't start: at an
 * added meeting, or in a series with several rules. Null when it can.
 */
function splitBlockedError(
  master: Event,
  originalStart: string
): GoogleApiError | null {
  const blocked = followingSplitBlocked({
    masterRecurrence: master.recurrence,
    masterStart: master.start,
    originalStart,
    seriesZone: seriesZoneOf(master),
  });
  return blocked ? refused({ reason: blocked }) : null;
}

/** A slot's moment (a date's start, in `zone`); null if it doesn't parse. */
function slotMoment(slot: string, zone: string): Temporal.Instant | null {
  return momentOf(asStart(slot), zone);
}

/** An occurrence's own changes to put back on a new series, and where. */
interface CarriedOccurrence {
  /** Its slot in the new series (its original start there). */
  at: string;
  changes: Partial<CreateEvent>;
}

/**
 * A This and following new series' times, from its first meeting `at`.
 * Times the edit left start it at that meeting's slot, with the series'
 * time and length (the occurrence's own move stays an exception), and a
 * new end alone gives that slot the edit's length. Else the edit's, in the
 * series' zone.
 */
function followingTimes(
  edited: CreateEvent,
  opened: Event,
  master: Event,
  at: string
): { end: Event["end"]; start: Event["start"] } {
  const zone = seriesZoneOf(master);
  const slot = seriesSlotAt(master, at);
  if (keepsTimes(edited, opened, zone)) {
    return slot;
  }
  if (sameTime(edited.start, opened.start, zone)) {
    return withLength({ ...master, ...slot }, edited) ?? slot;
  }
  return {
    end: inSeriesZone(edited.end, master.end),
    start: inSeriesZone(edited.start, master.start),
  };
}

/** `start` moved to `day`, at its own time; null when `day` isn't known. */
function onDay(
  start: Event["start"],
  day: Temporal.PlainDate | null,
  zone: string
): Event["start"] | null {
  if (!day) {
    return null;
  }
  if (start.date) {
    return { date: day.toString() };
  }
  const clock = clockOf(start, zone);
  return clock
    ? {
        ...start,
        dateTime: googleDateTime(
          day.toZonedDateTime({ plainTime: clock, timeZone: zone })
        ),
      }
    : null;
}

/**
 * `slot` in `start`'s form: its day for an all-day series, that day at
 * `start`'s time for a timed one.
 */
function inFormOf(
  slot: string,
  start: Event["start"],
  zone: string
): string | null {
  if (DATE_ONLY.test(slot) === Boolean(start.date)) {
    return slot;
  }
  const formed = onDay(start, dayOfStart(asStart(slot), zone), zone);
  return formed && slotOf(formed, zone);
}

/** `slot` when it has `start`'s form (a date, or a date-time); else null. */
function sameForm(slot: string, start: Event["start"]): string | null {
  return DATE_ONLY.test(slot) === Boolean(start.date) ? slot : null;
}

/** Whether an occurrence's original start is `slot` (an original start). */
function sameSlot(
  originalStart: Event["originalStartTime"],
  slot: string
): boolean {
  if (!originalStart) {
    return false;
  }
  // Both in one zone: a date reads the same day in either, a date-time
  // carries its own offset.
  const at = slotOf(originalStart, "UTC");
  const atMoment = at && slotMoment(at, "UTC");
  const slotAt = slotMoment(slot, "UTC");
  return Boolean(
    atMoment &&
      slotAt &&
      DATE_ONLY.test(at) === DATE_ONLY.test(slot) &&
      atMoment.equals(slotAt)
  );
}

/** A This and following split, as where its meetings land is read. */
interface SplitPlan {
  master: Event;
  /** Where the old series is cut: the opened occurrence's original start. */
  originalStart: string;
  /** The new series' rules, without skips. */
  recurrence: string[];
  /** The new series' start. */
  start: Event["start"];
}

const FREQ_PART = /FREQ=([A-Z]+)/;
const INTERVAL_PART = /INTERVAL=(\d+)/;

/** A rule's frequency and interval, as `FREQ` and `INTERVAL` give them. */
function cadence(rule: string): string {
  const freq = FREQ_PART.exec(rule)?.[1] ?? "";
  return `${freq}/${INTERVAL_PART.exec(rule)?.[1] ?? "1"}`;
}

/** A day's month, or year, for a rule repeating by one: [first, next). */
function periodOf(
  rule: string,
  day: Temporal.PlainDate
): [Temporal.PlainDate, Temporal.PlainDate] | null {
  if (rule.includes("FREQ=MONTHLY")) {
    const first = day.with({ day: 1 });
    return [first, first.add({ months: 1 })];
  }
  if (rule.includes("FREQ=YEARLY")) {
    const first = day.with({ day: 1, month: 1 });
    return [first, first.add({ years: 1 })];
  }
  return null;
}

/**
 * The days `rule`, repeating from `first`, meets on in [from, to); null
 * when it can't be read.
 */
function ruleDaysIn(
  rule: string,
  first: Temporal.PlainDate,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate
): Temporal.PlainDate[] | null {
  const days = ruleMeetings({
    first,
    from,
    rule: withoutEnd(rule),
    to: to.subtract({ days: 1 }),
  });
  return (
    days?.flatMap((day) => (day instanceof Temporal.PlainDate ? [day] : [])) ??
    null
  );
}

/**
 * Where a monthly or yearly series' meeting on `day` lands by its place in
 * its month or year (the third Monday made the third Tuesday): the new
 * rule's day as many into the period as `day` is into the old rule's,
 * each counted from the split, in the period as many on as the split moved
 * (the 28th moved to the 2nd of the next month puts Dec 28 on Jan 2). Null
 * for other rules, or none there.
 */
function placeInPeriod(
  day: Temporal.PlainDate,
  plan: SplitPlan
): Temporal.PlainDate | null {
  const { master, start } = plan;
  const [oldRule, ...oldOthers] = rulesOf(master.recurrence ?? []);
  const [newRule, ...newOthers] = rulesOf(plan.recurrence);
  const zone = repeatZone(master, start);
  const oldStart = dayOfStart(master.start, seriesZoneOf(master));
  const newStart = dayOfStart(start, zone);
  const split = dayOfStart(asStart(plan.originalStart), zone);
  if (
    !(oldRule && newRule && oldStart && newStart && split) ||
    oldOthers.length + newOthers.length > 0 ||
    cadence(oldRule) !== cadence(newRule)
  ) {
    return null;
  }
  const from = periodOf(oldRule, day);
  const splitPeriod = periodOf(oldRule, split);
  const newPeriod = periodOf(newRule, newStart);
  if (!(from && splitPeriod && newPeriod)) {
    return null;
  }
  const unit = oldRule.includes("FREQ=YEARLY") ? "years" : "months";
  const shift = splitPeriod[0].until(newPeriod[0], { largestUnit: unit });
  const to = periodOf(newRule, from[0].add(shift));
  const later = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
    Temporal.PlainDate.compare(a, b) < 0 ? b : a;
  const place = ruleDaysIn(
    oldRule,
    oldStart,
    later(from[0], split),
    from[1]
  )?.findIndex((at) => at.equals(day));
  if (!to || place === undefined || place < 0) {
    return null;
  }
  return (
    ruleDaysIn(newRule, newStart, later(to[0], newStart), to[1])?.[place] ??
    null
  );
}

/**
 * Where the old series' meeting at `slot` (an original start) lands in a
 * split's new series, in its form (made all day or timed, by day). Each
 * place is tried in turn, and the first the new series meets at is it:
 * - its own day, its time moved as much as the split's;
 * - in a monthly or yearly series, the new meeting as many into its month
 *   or year (`placeInPeriod`);
 * - as far on as the split moved, days and time.
 * A move of less than a day by the clock (23:30 to 00:30 the next day)
 * shifts each meeting by as much first. Null when the new series meets at
 * none.
 */
function landingOf(slot: string, plan: SplitPlan): string | null {
  const { master, start } = plan;
  const zone = repeatZone(master, start);
  const formed = inFormOf(slot, start, zone) ?? slot;
  const splitStart =
    inFormOf(plan.originalStart, start, zone) ?? plan.originalStart;
  const splitDay = dayOfStart(asStart(splitStart), zone);
  const ownDayStart = onDay(start, splitDay, zone);
  const ownDay =
    ownDayStart &&
    placeInNewSeries({
      newStart: ownDayStart,
      originalStart: formed,
      splitStart,
      zone,
    });
  const moved = placeInNewSeries({
    newStart: start,
    originalStart: formed,
    splitStart,
    zone,
  });
  const day = dayOfStart(asStart(formed), zone);
  const periodDay = day && placeInPeriod(day, plan);
  const inPeriod = periodDay && onDay(start, periodDay, zone);
  const period = inPeriod && slotOf(inPeriod, zone);
  const wall = (time: Event["start"]) =>
    momentOf(time, zone)?.toZonedDateTimeISO(zone).toPlainDateTime();
  const from = wall(asStart(splitStart));
  const to = wall(start);
  let order = [ownDay, period, moved];
  if (from && to && Math.abs(from.until(to).total("hours")) < 24) {
    order = [moved, ownDay, period];
  }
  return (
    order.find(
      (place) =>
        place &&
        seriesMeetsAt({
          recurrence: plan.recurrence,
          seriesZone: zone,
          slot: place,
          start,
        }) === true
    ) ?? null
  );
}

/**
 * Whether a meeting of the old series after the split, not deleted or
 * skipped, lands at `place` in the new series (`landingOf`), where a
 * deleted one's skip would cancel it: two rule days folded into one
 * (Mondays and Wednesdays made Wednesdays), or a meeting the split's move
 * carries onto another's place. Its old meetings near `place` (in its
 * month or year, for a series repeating by one) are each placed.
 */
function liveMeetingLandsAt(
  place: string,
  plan: SplitPlan & { cancelled: string[] }
): boolean {
  const { master, start } = plan;
  const oldZone = seriesZoneOf(master);
  const zone = repeatZone(master, start);
  const day = dayOfStart(asStart(place), zone);
  const split = slotMoment(plan.originalStart, oldZone);
  const splitDay = dayOfStart(asStart(plan.originalStart), oldZone);
  const newDay = dayOfStart(start, zone);
  const first = master.start.date
    ? dayOfStart(master.start, oldZone)
    : startInstant(master.start, oldZone)?.toZonedDateTimeISO(oldZone);
  if (!(day && split && splitDay && newDay && first)) {
    return false;
  }
  // Each meeting lands about as many days off as the split moved (a few
  // more across months of other lengths), or in its month or year.
  const reach = Math.abs(splitDay.until(newDay).days) + 4;
  const earlier = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
    Temporal.PlainDate.compare(a, b) < 0 ? a : b;
  const later = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
    Temporal.PlainDate.compare(a, b) < 0 ? b : a;
  return rulesOf(master.recurrence ?? []).some((rule) => {
    const period = periodOf(rule, day);
    const from = earlier(period?.[0] ?? day, day.subtract({ days: reach }));
    const to = later(period?.[1] ?? day, day.add({ days: reach }));
    const meetings =
      ruleMeetings({
        first,
        from: master.start.date
          ? from
          : from.toZonedDateTime({ timeZone: oldZone }).toInstant(),
        rule,
        to: master.start.date
          ? to
          : to.toZonedDateTime({ timeZone: oldZone }).toInstant(),
      }) ?? [];
    return meetings.some((meeting) => {
      const slot = slotString(meeting, oldZone);
      const at = slotMoment(slot, oldZone);
      return (
        at !== null &&
        Temporal.Instant.compare(at, split) > 0 &&
        !plan.cancelled.includes(slot) &&
        seriesMeetsAt({
          recurrence: master.recurrence ?? [],
          seriesZone: oldZone,
          slot,
          start: master.start,
        }) === true &&
        landingOf(slot, plan) === place
      );
    });
  });
}

/**
 * The rule's meeting on the split's own day at the new time, when the new
 * series meets there and starts on a day its rules don't meet (a Monday
 * moved to Sunday, Mondays kept). Google always meets at a series' start,
 * so that start is a meeting of its own, and the moved meeting would be
 * there twice.
 */
function movedOffRule(plan: SplitPlan): string[] {
  const { master, recurrence, start } = plan;
  const zone = repeatZone(master, start);
  const day = dayOfStart(start, zone);
  const rules = rulesOf(recurrence);
  if (
    !day ||
    rules.length === 0 ||
    rules.some(
      (rule) => (ruleDayCount({ from: day, rule, through: day }) ?? 1) > 0
    )
  ) {
    return [];
  }
  const ownDay = onDay(
    start,
    dayOfStart(asStart(plan.originalStart), seriesZoneOf(master)),
    zone
  );
  const place = ownDay && slotOf(ownDay, zone);
  return place &&
    place !== slotOf(start, zone) &&
    seriesMeetsAt({ recurrence, seriesZone: zone, slot: place, start }) === true
    ? [place]
    : [];
}

/**
 * A split's new rule (`saved`) with its COUNT: one kept from the series
 * (`keeps`) carries on with the positions left from the split; one the
 * user set, or sent with a new repeat, is theirs. Either takes one more
 * place for the moved meeting's skip where the rule meets (`moved`, from
 * `movedOffRule`; an added day's alone takes none). `spent` when no
 * position is left: only added days follow. `unknown` when the positions
 * left can't be told (`countLeft`) from the rule, or from `listed`.
 */
function carriedRule(params: {
  /** Google's list of the series' meetings, once read for the COUNT. */
  listed?: string[];
  master: Event;
  originalStart: string;
  /** Whether `saved` is the series' own rule, not a new repeat. */
  ownRule: boolean;
  saved: string[];
  start: Event["start"];
}):
  | { kind: "unknown" }
  | { kind: "spent"; recurrence: string[] }
  | { keeps: boolean; kind: "rule"; moved: string[]; recurrence: string[] } {
  const { master, originalStart, saved, start } = params;
  const seriesCount = countOf(master.recurrence);
  const keeps =
    params.ownRule && seriesCount !== null && countOf(saved) === seriesCount;
  const left = keeps
    ? countLeft({
        listed: params.listed,
        originalStart,
        recurrence: master.recurrence ?? [],
        seriesStart: master.start,
        seriesZone: seriesZoneOf(master),
      })
    : null;
  if (keeps && left === null) {
    return { kind: "unknown" };
  }
  if (left === 0) {
    const added = saved.filter((line) => !line.startsWith("RRULE:"));
    return { kind: "spent", recurrence: repeats(added) ? added : [] };
  }
  const counted = left === null ? saved : withCount(saved, left);
  const moved = movedOffRule({
    master,
    originalStart,
    recurrence: counted,
    start,
  });
  const places = moved.filter(
    (place) =>
      seriesMeetsAt({
        recurrence: rulesOf(counted),
        seriesZone: repeatZone(master, start),
        slot: place,
        start,
      }) === true
  ).length;
  const count = countOf(counted);
  return {
    keeps,
    kind: "rule",
    moved,
    recurrence: count === null ? counted : withCount(counted, count + places),
  };
}

/**
 * Where a split's skips go in its new series (`fromSplit`, the new rule
 * with the series' skips): occurrences `cancelled` after the split, and
 * the rule's own skips there, stay skipped where their meetings land
 * (`landingOf`), as changed ones are put back; an added one keeps its
 * slot. No skip lands on the new series' start (the meeting just saved),
 * on an added meeting it keeps, or on a live meeting moved there. With
 * the rule left without the skips it moves, and a kept COUNT (`keeps`)
 * lowered for the places they lose.
 */
function placeSkips(params: {
  cancelled: string[];
  fromSplit: string[];
  keeps: boolean;
  master: Event;
  originalStart: string;
  start: Event["start"];
}): { placed: string[]; rule: string[] } {
  const { fromSplit, master, originalStart, start } = params;
  const zone = seriesZoneOf(master);
  const newZone = repeatZone(master, start);
  const isAdded = (slot: string) =>
    addsSlot(master.recurrence ?? [], slot, zone);
  const split = slotMoment(originalStart, zone);
  // A skip the series had moves with its meeting; one it didn't was
  // lined up by the client and stays as written.
  const had = new Set(
    dateValues(master.recurrence ?? [], "EXDATE", zone).map(skipKey)
  );
  const ownSkip = (value: RecurrenceValue) => {
    const slot = slotString(value.instant ?? value.day, zone);
    const at = slotMoment(slot, zone);
    return (
      had.has(skipKey(value)) &&
      !isAdded(slot) &&
      Boolean(split && at && Temporal.Instant.compare(at, split) > 0)
    );
  };
  const ownSkips = dateValues(fromSplit, "EXDATE", zone)
    .filter(ownSkip)
    .map((value) => slotString(value.instant ?? value.day, zone));
  const rule = keepingDateValues(
    fromSplit,
    "EXDATE",
    zone,
    (value) => !ownSkip(value)
  );
  // Read without skips: a place already skipped is still its place.
  const plan: SplitPlan = {
    master,
    originalStart,
    recurrence: fromSplit.filter((line) => !line.startsWith("EXDATE")),
    start,
  };
  const startSlot = slotOf(start, newZone);
  const unskipped = (master.recurrence ?? []).filter(
    (line) => !line.startsWith("EXDATE")
  );
  const skips = [...params.cancelled, ...ownSkips].map((slot) => {
    const added = isAdded(slot);
    // One where nothing met has no meeting to follow: it stays where it
    // is, unless the new series meets there, where it would cancel one.
    const stale = !(
      added ||
      seriesMeetsAt({
        recurrence: unskipped,
        seriesZone: zone,
        slot,
        start: master.start,
      }) === true
    );
    const at = added || stale ? null : landingOf(slot, plan);
    const formed = inFormOf(at ?? slot, start, newZone);
    const ontoLive =
      formed !== null &&
      ((at !== null &&
        liveMeetingLandsAt(formed, { ...plan, cancelled: params.cancelled })) ||
        (stale &&
          seriesMeetsAt({
            recurrence: plan.recurrence,
            seriesZone: newZone,
            slot: formed,
            start,
          }) === true));
    return { added, at, formed, ontoLive, slot };
  });
  const placed = skips.flatMap(({ at, formed, ontoLive }) => {
    const ontoAdded =
      at !== null && formed !== null && addsSlot(fromSplit, formed, zone);
    return formed && formed !== startSlot && !ontoAdded && !ontoLive
      ? [formed]
      : [];
  });
  if (!params.keeps) {
    return { placed, rule };
  }
  return {
    placed,
    rule: countWithinSkips({
      ...placesOfSkips({ master, skips, startSlot }),
      recurrence: rule,
      start,
      zone: newZone,
    }),
  };
}

/**
 * What a split's skips (each with where it lands) do to a kept COUNT. A
 * rule position, skipped or deleted, whose skip has no place of its own
 * in the new series (none, the new start, another's, or a live meeting's)
 * is gone, and a place with it (`lost`), once however many skips it has.
 * One placed holds its place (`ruleSkips`, by where). An added day's skip
 * stays at its own time, so it holds none.
 */
function placesOfSkips(params: {
  master: Event;
  skips: {
    added: boolean;
    at: string | null;
    formed: string | null;
    ontoLive: boolean;
    slot: string;
  }[];
  startSlot: string | null;
}): { lost: number; ruleSkips: string[] } {
  const { master, startSlot } = params;
  const zone = seriesZoneOf(master);
  const lost = new Set<number>();
  const ruleSkips = new Set<string>();
  // Each place's first rule position, by moment: another there shares it.
  const takenBy = new Map<string, number>();
  for (const { added, at, formed, ontoLive, slot } of params.skips) {
    const moment = slotMoment(slot, zone)?.epochMilliseconds;
    if (moment === undefined || !ruleMeetingAt(slot, master)) {
      continue;
    }
    const onStart = formed === startSlot;
    const claims = Boolean(at && formed && !onStart);
    const first = claims && formed ? (takenBy.get(formed) ?? moment) : moment;
    if (formed && claims) {
      takenBy.set(formed, first);
    }
    if (onStart || (at === null && !added) || first !== moment || ontoLive) {
      lost.add(moment);
    } else if (at && formed) {
      ruleSkips.add(formed);
    }
  }
  return { lost: lost.size, ruleSkips: [...ruleSkips] };
}

/**
 * A kept COUNT (in `recurrence`) less the places lost, lowered again for
 * each placed skip (`ruleSkips`) its end leaves out: that skip frees no
 * place, so the end comes one meeting sooner, until every skip left falls
 * within it.
 */
function countWithinSkips(params: {
  lost: number;
  recurrence: string[];
  ruleSkips: string[];
  start: Event["start"];
  zone: string;
}): string[] {
  const { recurrence, ruleSkips, start, zone } = params;
  const base = (countOf(recurrence) ?? 0) - params.lost;
  let counted = withCount(recurrence, base);
  for (let round = 0; round <= ruleSkips.length; round += 1) {
    const past = ruleSkips.filter(
      (slot) =>
        seriesMeetsAt({
          recurrence: rulesOf(counted),
          seriesZone: zone,
          slot,
          start,
        }) === false
    ).length;
    if (base - past === countOf(counted)) {
      return counted;
    }
    counted = withCount(recurrence, base - past);
  }
  return counted;
}

/**
 * The occurrences a "This and following" new series carries, and where:
 * the opened one at its start with its own changes (its times only if
 * the edit left them), and later changed ones at their new places.
 */
function followingOccurrences(params: {
  /** The occurrences deleted on their own after the split. */
  cancelled: string[];
  /** The fields the edit changed, which the new series carries. */
  changes: Partial<CreateEvent>;
  edited: CreateEvent;
  exceptions: { occurrence: Event; originalStart: string }[];
  opened: Event;
  plan: SplitPlan;
}) {
  const { changes, edited, opened, plan } = params;
  const { master, start } = plan;
  const zone = seriesZoneOf(master);
  const own = changesOwnTo(opened, master, zone, changes);
  const { end: _end, start: _start, ...ownFields } = own;
  // A new end alone keeps the opened one's own start, now with that end.
  let openedChanges: Partial<CreateEvent> = ownFields;
  if (keepsTimes(edited, opened, zone)) {
    openedChanges = own;
  } else if (sameTime(edited.start, opened.start, zone) && own.start) {
    openedChanges = { ...own, end: edited.end };
  }
  return [
    {
      at: slotOf(start, zone),
      changes: openedChanges,
      opened: true as const,
      originalStart: plan.originalStart,
    },
    ...params.exceptions.map((exception) => {
      const exceptionOwn = changesOwnTo(
        exception.occurrence,
        master,
        zone,
        changes
      );
      return {
        at: carriedAt({
          cancelled: params.cancelled,
          own: exceptionOwn,
          plan,
          slot: exception.originalStart,
        }),
        changes: exceptionOwn,
        originalStart: exception.originalStart,
      };
    }),
  ];
}

/**
 * Where a changed occurrence at `slot` goes in a split's new series: an
 * added (RDATE) meeting keeps its slot, as its RDATE does; a rule meeting
 * lands where its meeting does (`landingOf`). Null when it has no place
 * of its own: its own times in a series of the other form, or a place
 * another old meeting, not deleted, lands on too (a move past later
 * meetings), which carrying it would overwrite.
 */
function carriedAt(params: {
  cancelled: string[];
  own: Partial<CreateEvent>;
  plan: SplitPlan;
  slot: string;
}): string | null {
  const { own, plan, slot } = params;
  const { master, start } = plan;
  if (addsSlot(master.recurrence ?? [], slot, seriesZoneOf(master))) {
    return sameForm(slot, start);
  }
  if (!sameForm(slot, start) && (own.start || own.end)) {
    return null;
  }
  const place = landingOf(slot, plan);
  const shared =
    place !== null &&
    liveMeetingLandsAt(place, {
      ...plan,
      cancelled: [...params.cancelled, slot],
    });
  return shared ? null : place;
}

/**
 * The occurrences with changes a new series can carry. Google keeps an
 * occurrence's changes only at a slot its series meets at, so any without
 * one, or two that land on one (an added meeting the new series keeps, or
 * the opened one's, counts), are refused by original start, before
 * anything is written.
 */
function placeCarried(params: {
  occurrences: {
    at: string | null;
    changes: Partial<CreateEvent>;
    /** The opened one: its slot is the new series' start, held even bare. */
    opened?: true;
    originalStart: string;
  }[];
  recurrence: string[];
  /** Whether the save is one only a series takes (`SeriesRefusal`). */
  seriesOnly: boolean;
  start: Event["start"];
  zone: string;
}): CarriedOccurrence[] | SeriesRefusal {
  const carried: CarriedOccurrence[] = [];
  const lost = new Set<string>();
  const placed = new Map<number, string>();
  // The opened one's slot, held though it carries nothing: it isn't named.
  const bare = params.occurrences.find(
    (occurrence) =>
      occurrence.opened && Object.keys(occurrence.changes).length === 0
  );
  const held = bare?.at
    ? (slotMoment(bare.at, params.zone)?.epochMilliseconds ?? null)
    : null;
  for (const { at, changes, originalStart } of params.occurrences) {
    if (Object.keys(changes).length === 0) {
      continue;
    }
    const meets =
      at !== null &&
      seriesMeetsAt({
        recurrence: params.recurrence,
        seriesZone: params.zone,
        slot: at,
        start: params.start,
      }) === true;
    const moment = at && meets ? slotMoment(at, params.zone) : null;
    const taken = moment && placed.get(moment.epochMilliseconds);
    const ontoAdded =
      at !== null &&
      at !== originalStart &&
      addsSlot(params.recurrence, at, params.zone);
    if (
      !(at && moment) ||
      taken ||
      ontoAdded ||
      moment.epochMilliseconds === held
    ) {
      lost.add(taken || originalStart).add(originalStart);
      continue;
    }
    placed.set(moment.epochMilliseconds, originalStart);
    carried.push({ at, changes });
  }
  return lost.size > 0
    ? naming("dropsChangedOccurrences", [...lost], params.seriesOnly)
    : carried;
}

/**
 * The rules a save writes: the series' own when it sends none, and a rule
 * sent alone with the series' skips and the added days still on, which a
 * client rebuilding the rule may leave out ("Repeat: None" stays none).
 * An added day deleted (`cancelled`) or skipped shows nothing: left out,
 * it goes.
 */
function savedRule(
  saved: string[] | undefined,
  master: Event,
  cancelled: string[]
): string[] {
  if (!saved) {
    return master.recurrence ?? [];
  }
  if (!repeats(saved)) {
    return saved;
  }
  if (saved.some((line) => line.startsWith("RDATE"))) {
    return withSeriesSkips(saved, master);
  }
  const own = master.recurrence ?? [];
  const zone = seriesZoneOf(master);
  const gone = new Set([
    ...dateValues(own, "EXDATE", zone).map(skipKey),
    ...cancelled.flatMap((slot) => {
      const value = readRecurrenceValue(slot, zone, zone);
      return value ? [skipKey(value)] : [];
    }),
  ]);
  const added = keepingDateValues(
    own.filter((line) => line.startsWith("RDATE")),
    "RDATE",
    zone,
    (value) => !gone.has(skipKey(value))
  );
  return withSeriesSkips([...saved, ...added], master);
}

/**
 * The options Google needs to write what `sets` gives on purpose: a meeting
 * link or its removal only at conference data version 1, attachments only
 * when asked to. A link the payload keeps is written at version 1 too.
 */
function writeOptions(
  payload: { conferenceData?: unknown },
  sets: Partial<CreateEvent>
): { conferenceDataVersion?: number; supportsAttachments?: boolean } {
  const conference = "conferenceData" in sets || payload.conferenceData;
  return {
    ...(conference ? { conferenceDataVersion: 1 } : {}),
    ...("attachments" in sets ? { supportsAttachments: true } : {}),
  };
}

function summarizeEventForDebug(event: CreateEvent) {
  return {
    summary: event.summary,
    eventType: event.eventType ?? "default",
    hasFocusTimeProperties: Boolean(event.focusTimeProperties),
    hasOutOfOfficeProperties: Boolean(event.outOfOfficeProperties),
    hasWorkingLocationProperties: Boolean(event.workingLocationProperties),
    recurrenceCount: event.recurrence?.length ?? 0,
    start: event.start,
    end: event.end,
  };
}

function logGoogleEventUpdateFailure(params: {
  operation: "create" | "delete" | "update";
  calendarId: string;
  eventId?: string;
  scope?: string;
  event: CreateEvent;
  cause: unknown;
}) {
  console.error("[GoogleCalendar] Event mutation failed", {
    operation: params.operation,
    calendarId: params.calendarId,
    eventId: params.eventId,
    scope: params.scope,
    event: summarizeEventForDebug(params.event),
    cause: params.cause,
  });
}

function buildThisOccurrenceUpdatePayload(
  event: CreateEvent,
  currentEvent: Event
): CreateEvent {
  if (!currentEvent.recurringEventId) {
    return event;
  }

  const { recurrence: _recurrence, ...singleOccurrence } = event;
  return {
    ...singleOccurrence,
    recurringEventId: currentEvent.recurringEventId,
    ...(currentEvent.originalStartTime
      ? { originalStartTime: currentEvent.originalStartTime }
      : {}),
  };
}

// -- Service Definition --

export interface GoogleCalendarService {
  readonly createCalendar: (
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly createEvent: (
    calendarId: string,
    event: CreateEvent
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly deleteCalendar: (
    calendarId: string
  ) => Effect.Effect<void, GoogleApiError>;
  /**
   * Delete an event, supporting recurring scopes.
   *
   * - `this`: cancels just the instance/eventId by setting status to "cancelled"
   * - `all`: deletes the series master
   * - `following`: truncates the original series at the occurrence date
   *
   * Non-recurring events accept `all`; only `following` requires a series.
   */
  readonly deleteEvent: (
    calendarId: string,
    eventId: string,
    scope: RecurrenceScope
  ) => Effect.Effect<void, GoogleApiError | GoogleCalendarZodError>;
  readonly getCalendar: (
    calendarId: string
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly getEvent: (
    calendarId: string,
    eventId: string
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly getMasterRecurrence: (
    calendarId: string,
    event: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly listCalendarIds: () => Effect.Effect<
    string[],
    GoogleApiError | GoogleCalendarZodError
  >;
  // Calendar Operations
  readonly listCalendars: () => Effect.Effect<
    Calendar[],
    GoogleApiError | GoogleCalendarZodError
  >;

  readonly listColors: () => Effect.Effect<
    Colors,
    GoogleApiError | GoogleCalendarZodError
  >;

  // Event Operations
  readonly listEvents: (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) => Effect.Effect<Event[], GoogleApiError | GoogleCalendarZodError>;
  /**
   * Move an event between calendars, supporting recurring scopes.
   *
   * - `this`: moves just the instance/eventId
   * - `all`: moves the series master
   * - `following`: truncates the original series and creates a new series in the destination
   *
   * If `scope !== \"this\"` and the event is not recurring, this returns an error.
   */
  readonly moveEvent: (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string,
    scope: RecurrenceScope
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly stopWatch: (params: {
    channelId: string;
    resourceId: string;
  }) => Effect.Effect<void, GoogleApiError>;
  readonly updateCalendar: (
    calendarId: string,
    calendar: CreateCalendar
  ) => Effect.Effect<Calendar, GoogleApiError | GoogleCalendarZodError>;
  readonly updateEvent: (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope,
    currentEvent: Event
  ) => Effect.Effect<Event, GoogleApiError | GoogleCalendarZodError>;
  readonly watchCalendarEvents: (
    calendarId: string,
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
  readonly watchCalendarList: (
    channel: GoogleWatchChannelInput
  ) => Effect.Effect<
    GoogleWatchChannelResult,
    GoogleApiError | GoogleCalendarZodError
  >;
}

export class GoogleCalendar extends Context.Service<
  GoogleCalendar,
  GoogleCalendarService
>()("GoogleCalendar") {}

// -- Errors --

export class GoogleApiError extends Schema.TaggedError<GoogleApiError>()(
  "GoogleApiError",
  {
    cause: Schema.Unknown,
    message: Schema.optional(Schema.String),
    /**
     * A write Kompose won't make to a series, refused before anything
     * changed: it won't work on a retry either.
     */
    refusal: Schema.optional(SeriesRefusalSchema),
  }
) {
  /**
   * What the API sends the client; `cause` stays on the server. A
   * refusal's `data` says which, for the client to word.
   */
  get publicError() {
    return this.refusal
      ? ({
          code: "BAD_REQUEST",
          data: this.refusal,
          message: refusalMessage(this.refusal),
        } as const)
      : ({
          code: "BAD_GATEWAY",
          message: "Google Calendar request failed. Try again.",
        } as const);
  }
}

export class GoogleCalendarZodError extends Schema.TaggedError<GoogleCalendarZodError>()(
  "GoogleCalendarZodError",
  {
    cause: Schema.Unknown,
  }
) {}

// -- Implementation --

export function makeGoogleCalendarService(
  accessToken: string
): GoogleCalendarService {
  const client = new GoogleCalendarClient({ accessToken });

  // --- Calendar Methods ---

  const listCalendars = Effect.fn("GoogleCalendar.listCalendars")(function* () {
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.list(),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    if (!response.items) {
      return [];
    }

    return z.array(CalendarSchema).parse(response.items);
  });

  const listCalendarIds = Effect.fn("GoogleCalendar.listCalendarIds")(
    function* () {
      const calendars = yield* listCalendars();
      return Array.from(
        new Set(
          calendars
            .map((calendar) => calendar.id)
            .filter((id): id is string => Boolean(id))
        )
      );
    }
  );

  const getCalendar = Effect.fn("GoogleCalendar.getCalendar")(function* (
    calendarId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.retrieve(calendarId),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const createCalendar = Effect.fn("GoogleCalendar.createCalendar")(function* (
    calendar: CreateCalendar
  ) {
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.create(calendar),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const updateCalendar = Effect.fn("GoogleCalendar.updateCalendar")(function* (
    calendarId: string,
    calendar: CreateCalendar
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    const response = yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.update(calendarId, calendar),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = CalendarSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const deleteCalendar = Effect.fn("GoogleCalendar.deleteCalendar")(function* (
    calendarId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.tryPromise({
      try: () => client.users.me.calendarList.delete(calendarId),
      catch: (cause) => new GoogleApiError({ cause }),
    });
  });

  const parseWatchChannelResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = z
        .object({
          expiration: z.string().optional(),
          id: z.string().min(1),
          resourceId: z.string().min(1),
        })
        .safeParse(response);

      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      return {
        channelId: parsed.data.id,
        expiration: parsed.data.expiration,
        resourceId: parsed.data.resourceId,
      } satisfies GoogleWatchChannelResult;
    });

  const watchCalendarList = Effect.fn("GoogleCalendar.watchCalendarList")(
    function* (channel: GoogleWatchChannelInput) {
      yield* Effect.annotateCurrentSpan("channelId", channel.id);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.users.me.calendarList.watch({
            address: channel.address,
            expiration: channel.expiration,
            id: channel.id,
            token: channel.token,
            type: "web_hook",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* parseWatchChannelResponse(response);
    }
  );

  const watchCalendarEvents = Effect.fn("GoogleCalendar.watchCalendarEvents")(
    function* (calendarId: string, channel: GoogleWatchChannelInput) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("channelId", channel.id);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.watch(calendarId, {
            address: channel.address,
            expiration: channel.expiration,
            id: channel.id,
            token: channel.token,
            type: "web_hook",
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      return yield* parseWatchChannelResponse(response);
    }
  );

  const stopWatch = Effect.fn("GoogleCalendar.stopWatch")(function* (params: {
    channelId: string;
    resourceId: string;
  }) {
    yield* Effect.annotateCurrentSpan("channelId", params.channelId);
    yield* Effect.annotateCurrentSpan("resourceId", params.resourceId);
    yield* Effect.tryPromise({
      try: () =>
        client.stopWatching.stopWatching({
          id: params.channelId,
          resourceId: params.resourceId,
        }),
      catch: (cause) => new GoogleApiError({ cause }),
    });
  });

  // --- Event Methods ---

  const listEvents = Effect.fn("GoogleCalendar.listEvents")(function* (
    calendarId: string,
    timeMin: string,
    timeMax: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    // Expanded recurring events can exceed one page; request the maximum and follow page tokens.
    const items: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.list(calendarId, {
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500,
            pageToken,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
      items.push(...(response.items ?? []));
      pageToken = response.nextPageToken ?? undefined;
    } while (pageToken);

    const parsed = z.array(EventSchema).safeParse(items);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const getEvent = Effect.fn("GoogleCalendar.getEvent")(function* (
    calendarId: string,
    eventId: string
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    const response = yield* Effect.tryPromise({
      try: () => client.calendars.events.retrieve(eventId, { calendarId }),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = EventSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const createEvent = Effect.fn("GoogleCalendar.createEvent")(function* (
    calendarId: string,
    event: CreateEvent
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan(
      "eventType",
      event.eventType ?? "default"
    );
    const conferenceDataVersion = writeOptions(event, {}).conferenceDataVersion;
    const response = yield* Effect.tryPromise({
      try: () =>
        client.calendars.events.create(calendarId, {
          ...event,
          ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
        }),
      catch: (cause) => {
        logGoogleEventUpdateFailure({
          operation: "create",
          calendarId,
          event,
          cause,
        });
        return new GoogleApiError({ cause });
      },
    });

    const parsed = EventSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const parseEventResponse = (response: unknown) =>
    Effect.gen(function* () {
      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return parsed.data;
    });

  const updateEventThis = (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    currentEvent: Event,
    /** The fields this write sets on purpose, cleared ones too. */
    sets: Partial<CreateEvent> = {}
  ) =>
    Effect.gen(function* () {
      const payload = buildThisOccurrenceUpdatePayload(event, currentEvent);

      yield* Effect.annotateCurrentSpan(
        "eventType",
        payload.eventType ?? "default"
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            ...payload,
            calendarId,
            ...writeOptions(payload, sets),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId,
            scope: "this",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      return yield* parseEventResponse(response);
    });

  /** Every item of a listing Google splits into pages. */
  const allPages = <T>(
    fetchPage: (
      pageToken: string | undefined
    ) => Promise<{ items?: T[] | null; nextPageToken?: string | null }>
  ) =>
    Effect.gen(function* () {
      const items: T[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () => fetchPage(pageToken),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        items.push(...(response.items ?? []));
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return items;
    });

  /**
   * `master`'s exceptions, sorted by `sortExceptions` (those after `after`
   * when given). Listed by iCalUID, which returns only the master and its
   * exceptions, so an endless series isn't expanded.
   */
  const exceptionsOf = (calendarId: string, master: Event, after?: string) =>
    Effect.gen(function* () {
      const iCalUID = master.iCalUID;
      if (!iCalUID) {
        // Google gives every event one; without it the exceptions can't
        // be checked, so nothing is written.
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Series has no iCalUID") })
        );
      }
      const items = yield* allPages((pageToken) =>
        client.calendars.events.list(calendarId, {
          iCalUID,
          maxResults: 2500,
          pageToken,
          showDeleted: true,
        })
      );
      const parsed = SeriesListingSchema.safeParse(items);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return sortExceptions(parsed.data, master, after);
    });

  /**
   * An edit through `occurrence` applied to its series: the series' fields
   * plus only those the user changed, so an occurrence's own title or
   * notes aren't written onto every meeting.
   */
  const asSeriesEdit = (
    edited: CreateEvent,
    occurrence: Event,
    master: Event
  ) => {
    const changes = changedFields(edited, occurrence);
    const event = { ...sanitizeEventPayload(master), ...changes };
    // A guest list the edit changes keeps each guest's answer to the
    // series, not to the occurrence it was edited through.
    return {
      changes,
      event: changes.attendees
        ? {
            ...event,
            attendees: seriesAttendees({
              edited: changes.attendees,
              occurrence: occurrence.attendees,
              series: master.attendees,
            }),
          }
        : event,
    };
  };

  /**
   * What an Entire series save (`plan`) writes of its rules, and carries of
   * the first meeting, once the occurrences changed or deleted on their
   * own are read (`afterSave`); refused when one would be lost or resized.
   */
  const keptOccurrences = (calendarId: string, plan: SeriesPlan) =>
    Effect.gen(function* () {
      const { master, times } = plan;
      if (
        !(plan.movesSlots || !sameLength(times, master, seriesZoneOf(master)))
      ) {
        return { carried: {}, recurrence: plan.recurrence };
      }
      const { cancelled, changed } = yield* exceptionsOf(calendarId, master);
      const kept = afterSave({ cancelled, changed, plan });
      return "reason" in kept ? yield* Effect.fail(refused(kept)) : kept;
    });

  const updateEventAll = (
    calendarId: string,
    input: CreateEvent,
    currentEvent: Event,
    master: Event
  ) =>
    Effect.gen(function* () {
      const edited = withOneForm(input, currentEvent);
      const zone = seriesZoneOf(master);
      const { changes, event } = asSeriesEdit(edited, currentEvent, master);
      const times = entireSeriesTimes({
        edited,
        master,
        occurrence: currentEvent,
      });
      if (
        movesSeveralADay({
          edited,
          master,
          occurrence: currentEvent,
          start: times.start,
        })
      ) {
        return yield* Effect.fail(refused({ reason: "severalTimesADay" }));
      }

      const movesStart = !sameTime(times.start, master.start, zone);
      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None").
      const rule = edited.recurrence
        ? withSeriesSkips(edited.recurrence, master)
        : (master.recurrence ?? []);
      const plan: SeriesPlan = {
        // As the series is written: a guest list merged into its own.
        changes: changes.attendees
          ? { ...changes, attendees: event.attendees }
          : changes,
        edited,
        master,
        // Read for what it means: the series' own skips, written again in
        // another form, aren't a new rule.
        movesSlots:
          movesStart ||
          recurrenceValues(rule, zone) !==
            recurrenceValues(master.recurrence ?? [], zone),
        movesStart,
        opened: currentEvent,
        recurrence: rule,
        seriesOnly: givesNewRepeat({
          from: master.start,
          master,
          saved: edited.recurrence,
          start: times.start,
        }),
        times,
      };
      const { carried, recurrence } = yield* keptOccurrences(calendarId, plan);

      const payload: CreateEvent = {
        ...event,
        end: times.end,
        start: times.start,
        ...carried,
        recurrence,
      };
      yield* Effect.annotateCurrentSpan(
        "eventType",
        payload.eventType ?? "default"
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...payload,
            calendarId,
            // A first meeting's own, carried by "Repeat: None", or ones
            // the edit sets or clears.
            ...writeOptions(payload, { ...changes, ...carried }),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: master.id,
            scope: "all",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      const updated = yield* parseEventResponse(response);
      // A new start cancels the opened occurrence's own times with the
      // rest of its exception, and an ended repeat all of it (the first
      // meeting's carried above); there's nothing of its own left to write.
      if (!movesStart && repeats(recurrence)) {
        yield* applyToOpened({
          calendarId,
          changes,
          edited,
          master,
          occurrence: currentEvent,
        });
      }
      return updated;
    });

  /**
   * Google keeps an occurrence's own values when its series changes, so an
   * edit through an occurrence with its own (moved and renamed, say) is
   * also written to it when it changes one of those fields or its times.
   */
  const applyToOpened = (params: {
    calendarId: string;
    changes: Partial<CreateEvent>;
    edited: CreateEvent;
    master: Event;
    occurrence: Event;
  }) => {
    const { changes, edited, master, occurrence } = params;
    const zone = seriesZoneOf(master);
    const own = changesOwnTo(occurrence, master, zone);
    const times = timesOnOwnDay({ edited, master, occurrence });
    const retimed = !keepsTimes(times, occurrence, zone);
    const overridden = Object.keys(changes).some((field) => field in own);
    // One that is just the series' own follows the series.
    const setsOwn = Object.keys(own).length > 0;
    if (!(occurrence.recurringEventId && setsOwn && (overridden || retimed))) {
      return Effect.void;
    }
    return updateEventThis(
      params.calendarId,
      occurrence.id,
      { ...sanitizeEventPayload(occurrence), ...changes, ...times },
      occurrence,
      changes
    ).pipe(Effect.asVoid);
  };

  /**
   * The rule a split's new part repeats with: `edited`, or the series'.
   * Its added days before the split stay with the old part. A COUNT kept
   * from the series carries on with the positions left (a five-time series
   * split at its third runs three more, not five); a COUNT the user set is
   * theirs. Occurrences `cancelled` after the split, and the rule's own
   * skips there, stay skipped where their meetings land (`placeSkips`).
   * Refuses, before any write,
   * a kept COUNT whose positions left can't be told, or a rule the save
   * sets that ends before `start`.
   */
  const newSeriesRecurrence = (params: {
    calendarId: string;
    cancelled: string[];
    edited: string[] | undefined;
    master: Event;
    originalStart: string;
    start: Event["start"];
  }) =>
    Effect.gen(function* () {
      const { master, originalStart, start } = params;
      const zone = seriesZoneOf(master);
      const ownRule = !givesNewRepeat({
        from: asStart(originalStart),
        master,
        saved: params.edited,
        start,
      });
      const saved = splitAddedDays(
        savedRule(params.edited, master, params.cancelled),
        originalStart,
        zone,
        "from"
      );
      const counting = { master, originalStart, ownRule, saved, start };
      let carried = carriedRule(counting);
      // A clock change before the split: Google's list tells what it did.
      if (carried.kind === "unknown") {
        const listed = yield* listOccurrenceStarts(params.calendarId, master);
        carried = carriedRule({ ...counting, listed });
      }
      if (carried.kind === "unknown") {
        return yield* Effect.fail(refused({ reason: "countUnknown" }));
      }
      if (carried.kind === "spent") {
        return carried.recurrence;
      }
      const { keeps, moved, recurrence: fromSplit } = carried;
      const newZone = repeatZone(master, start);
      const { placed, rule } = placeSkips({
        cancelled: params.cancelled,
        fromSplit,
        keeps,
        master,
        originalStart,
        start,
      });
      const recurrence = skipping(rule, [...placed, ...moved], zone);
      if (!endsBeforeStart(recurrence, start, newZone)) {
        return recurrence;
      }
      // The series' own end before the new start (a meeting moved past
      // it): its rule is spent, so the new part has that meeting and any
      // added (RDATE) ones after it; one event if none. An end the save
      // sets there is refused.
      if (ownRule) {
        const added = recurrence.filter((line) => !line.startsWith("RRULE:"));
        return repeats(added) ? added : [];
      }
      return yield* Effect.fail(refused({ reason: "endsBeforeStart" }));
    });

  /** Every meeting of `master` Google lists, by original start, cancelled ones too. */
  const listOccurrenceStarts = (calendarId: string, master: Event) =>
    Effect.gen(function* () {
      const items = yield* allPages((pageToken) =>
        client.calendars.events.instances(master.id, {
          calendarId,
          maxResults: 2500,
          pageToken,
          showDeleted: true,
        })
      );
      return items.flatMap((item) => {
        const start = item.originalStartTime ?? item.start;
        const slot = start && slotOf(start, seriesZoneOf(master));
        return slot ? [slot] : [];
      });
    });

  /** Writes a carried occurrence's own changes onto its new series' one. */
  const putBack = (
    calendarId: string,
    seriesId: string,
    carried: CarriedOccurrence
  ) =>
    Effect.gen(function* () {
      const listed = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.instances(seriesId, {
            calendarId,
            maxResults: 1,
            originalStart: carried.at,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
      const occurrence = yield* parseEventResponse(listed.items?.[0]);
      // Only the occurrence at its place takes its changes: any other
      // answer fails the split before the cut (Google's reference doesn't
      // say how it reads an all-day series' date there).
      if (!sameSlot(occurrence.originalStartTime, carried.at)) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Google returned another occurrence"),
          })
        );
      }
      // Written like a single occurrence's update, so it keeps its place.
      const payload = {
        ...sanitizeEventPayload(occurrence),
        originalStartTime: occurrence.originalStartTime,
        recurringEventId: occurrence.recurringEventId,
        ...carried.changes,
      };
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(occurrence.id, {
            ...payload,
            calendarId,
            // A meeting link the occurrence dropped on its own, and its
            // attachments, are its changes too.
            ...writeOptions(payload, carried.changes),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: occurrence.id,
            scope: "following-carry",
            event: payload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });
    });

  /**
   * What a cut whose request failed did, read back from Google: `cut` (it
   * went through), `unchanged`, or `unknown` (unreadable, or changed some
   * other way meanwhile, so which meetings it has isn't known).
   */
  const cutOutcome = (
    calendarId: string,
    master: Event,
    cutRecurrence: string[]
  ) =>
    Effect.gen(function* () {
      const current = yield* Effect.exit(getEvent(calendarId, master.id));
      if (Exit.isFailure(current)) {
        return "unknown" as const;
      }
      const zone = seriesZoneOf(master);
      const now = recurrenceValues(current.value.recurrence ?? [], zone);
      if (now === recurrenceValues(master.recurrence ?? [], zone)) {
        return "unchanged" as const;
      }
      return now === recurrenceValues(cutRecurrence, zone)
        ? ("cut" as const)
        : ("unknown" as const);
    });

  /**
   * Splits `master` at `originalStart` into `newSeries` (in
   * `destinationCalendarId`), all or nothing. The new series is created
   * first, under an id chosen here, with `carried` put back on it; then
   * the old one is cut to end before the split (Google drops its later
   * occurrences). A failure before the cut deletes the new series. After
   * a failed cut the old series is read back: cut, the split stands;
   * unchanged after no try that may still go through, the new one is
   * deleted and the call fails; otherwise both stay (a meeting shown twice
   * beats one lost) and the call fails.
   */
  const splitSeries = (params: {
    calendarId: string;
    carried: CarriedOccurrence[];
    destinationCalendarId: string;
    master: Event;
    newSeries: CreateEvent;
    originalStart: string;
  }) =>
    Effect.gen(function* () {
      const { calendarId, destinationCalendarId, master, newSeries } = params;
      yield* Effect.annotateCurrentSpan(
        "eventType",
        newSeries.eventType ?? "default"
      );
      // Google takes an id of base32hex characters (0-9, a-v).
      const seriesId = crypto.randomUUID().replaceAll("-", "");
      // Its failure leaves both series (a meeting shown twice): logged, and
      // the error that caused the rollback returned.
      const discardNew = Effect.tryPromise({
        try: () =>
          client.calendars.events.delete(seriesId, {
            calendarId: destinationCalendarId,
          }),
        catch: (cause) => {
          // Not found: the create never went through, so nothing is left.
          if (!(cause instanceof NotFoundError)) {
            logGoogleEventUpdateFailure({
              operation: "delete",
              calendarId: destinationCalendarId,
              eventId: seriesId,
              scope: "following-rollback",
              event: newSeries,
              cause,
            });
          }
          return new GoogleApiError({ cause });
        },
      }).pipe(Effect.ignore);

      // A new part that doesn't repeat ("Repeat: None") is one event, with
      // no recurrence lines: the one carried (at its start) goes on it.
      const repeating = repeats(newSeries.recurrence);
      const startSlot = slotOf(newSeries.start, seriesZoneOf(master));
      const atStart = params.carried.find(
        (carried) => carried.at === startSlot
      );
      const written = repeating
        ? newSeries
        : { ...newSeries, ...atStart?.changes, recurrence: [] };
      const created = yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.create(
              destinationCalendarId,
              {
                ...written,
                id: seriesId,
                // Its attachments, when it has any, are written on purpose.
                ...writeOptions(
                  written,
                  written.attachments?.length
                    ? { attachments: written.attachments }
                    : {}
                ),
              },
              // Retried below: a 409 there means a try whose answer was
              // lost made it, which is read back, not tried again.
              { maxRetries: 0 }
            ),
          catch: (cause) => new GoogleApiError({ cause }),
        }).pipe(
          Effect.retry(WRITE_RETRIES),
          // Logged once, for the last try; taken is no failure.
          Effect.tapError((error) =>
            error.cause instanceof ConflictError
              ? Effect.void
              : Effect.sync(() =>
                  logGoogleEventUpdateFailure({
                    operation: "create",
                    calendarId: destinationCalendarId,
                    event: written,
                    cause: error.cause,
                  })
                )
          ),
          // Taken: a try whose answer was lost made it (the id is ours).
          Effect.catchIf(
            (error) => error.cause instanceof ConflictError,
            () => getEvent(destinationCalendarId, seriesId)
          )
        );
        const series = yield* parseEventResponse(response);
        yield* Effect.forEach(
          repeating ? params.carried : [],
          (carried) => putBack(destinationCalendarId, seriesId, carried),
          { concurrency: 4, discard: true }
        );
        return series;
      }).pipe(Effect.onError(() => discardNew));

      const cutRecurrence = truncateRecurrenceForFollowing({
        originalStart: params.originalStart,
        recurrence: master.recurrence ?? [],
        seriesStart: master.start,
        seriesZone: seriesZoneOf(master),
      });
      const cutPayload = sanitizeEventPayload({
        ...master,
        recurrence: cutRecurrence,
      });
      // A cut is tried again (it writes the same whole event each time, so
      // an answer to a later try is true). One that may still go through is
      // remembered: if every try fails, the old series is left as it reads
      // back rather than the new one deleted.
      let unanswered = false;
      const cut = yield* Effect.exit(
        Effect.tryPromise({
          try: () =>
            client.calendars.events.update(
              master.id,
              {
                ...cutPayload,
                calendarId,
                ...writeOptions(cutPayload, {}),
              },
              { maxRetries: 0 }
            ),
          catch: (cause) => new GoogleApiError({ cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              unanswered ||= mayGoThrough(error);
            })
          ),
          Effect.retry(WRITE_RETRIES),
          // Logged once, for the last try.
          Effect.tapError((error) =>
            Effect.sync(() =>
              logGoogleEventUpdateFailure({
                operation: "update",
                calendarId,
                eventId: master.id,
                scope: "following-truncate",
                event: cutPayload,
                cause: error.cause,
              })
            )
          )
        )
      );
      if (Exit.isFailure(cut)) {
        const outcome = yield* cutOutcome(calendarId, master, cutRecurrence);
        if (outcome === "unchanged" && !unanswered) {
          yield* discardNew;
        }
        if (outcome !== "cut") {
          return yield* Effect.failCause(cut.cause);
        }
      }
      return created;
    });

  /**
   * Whether "This and following" from `occurrence` is the whole series:
   * nothing of it comes before (it's at or before the series' start, with
   * no meeting added before it). Otherwise it splits there.
   */
  const isWholeSeries = (occurrence: Event, master: Event) => {
    const zone = seriesZoneOf(master);
    const originalStart = originalStartOf(occurrence, zone);
    return Boolean(
      originalStart &&
        followingIsWhole({
          masterRecurrence: master.recurrence,
          masterStart: master.start,
          originalStart,
          seriesZone: zone,
        })
    );
  };

  /**
   * The series an occurrence's "This and following" acts on, and where it
   * splits: refused where a new series can't start (`splitBlockedError`).
   */
  const followingSplit = (calendarId: string, occurrence: Event) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, occurrence);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }
      const originalStart = originalStartOf(occurrence, seriesZoneOf(master));
      if (!originalStart) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }
      return { master, originalStart };
    });

  const updateEventFollowing = (
    calendarId: string,
    input: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      // A form toggled to or from all day can send both forms' fields.
      const edited = withOneForm(input, currentEvent);
      const { master, originalStart } = yield* followingSplit(
        calendarId,
        currentEvent
      );
      const zone = seriesZoneOf(master);
      // From the series' start, or an earlier added meeting with nothing
      // before it, it's the whole series: an Entire series save when it
      // opens the series, or keeps its times and repeat (from an added
      // meeting, a new time, date or repeat is that meeting's alone).
      const whole =
        isWholeSeries(currentEvent, master) &&
        (opensSeries(currentEvent, master) ||
          (keepsTimes(edited, currentEvent, zone) &&
            repeats(edited.recurrence ?? master.recurrence) &&
            !newRepeat({
              moved: null,
              own: master.recurrence ?? [],
              saved: edited.recurrence,
            })));
      if (whole) {
        return yield* updateEventAll(calendarId, edited, currentEvent, master);
      }
      const blocked = splitBlockedError(master, originalStart);
      if (blocked) {
        return yield* Effect.fail(blocked);
      }
      const { changes, event } = asSeriesEdit(edited, currentEvent, master);
      const times = followingTimes(edited, currentEvent, master, originalStart);
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None").
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        cancelled: exceptions.cancelled,
        edited: edited.recurrence,
        master,
        originalStart,
        start: times.start,
      });
      const carried = placeCarried({
        // Each is carried, or the save refused if the new part has no
        // place for it ("Repeat: None" has none).
        occurrences: followingOccurrences({
          cancelled: exceptions.cancelled,
          changes,
          edited,
          exceptions: exceptions.changed,
          opened: currentEvent,
          plan: { master, originalStart, recurrence, start: times.start },
        }),
        recurrence,
        seriesOnly: givesNewRepeat({
          from: asStart(originalStart),
          master,
          saved: edited.recurrence,
          start: times.start,
        }),
        start: times.start,
        zone: repeatZone(master, times.start),
      });
      if (!Array.isArray(carried)) {
        return yield* Effect.fail(refused(carried));
      }
      return yield* splitSeries({
        calendarId,
        carried,
        destinationCalendarId: calendarId,
        master,
        // The new part keeps the series' zone (its times are in it).
        newSeries: { ...event, ...times, recurrence },
        originalStart,
      });
    });

  const updateEvent = Effect.fn("GoogleCalendar.updateEvent")(function* (
    calendarId: string,
    eventId: string,
    event: CreateEvent,
    scope: RecurrenceScope,
    currentEvent: Event
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan("scope", scope);
    switch (scope) {
      case "this":
        return yield* updateEventThis(calendarId, eventId, event, currentEvent);
      case "all":
        return yield* updateEventAll(
          calendarId,
          event,
          currentEvent,
          yield* getMasterRecurrence(calendarId, currentEvent)
        );
      case "following":
        return yield* updateEventFollowing(calendarId, event, currentEvent);
      default:
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
        );
    }
  });

  /** Cancel an occurrence without affecting the rest of its series. */
  const deleteEventThis = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);

      // Preserve the occurrence identity and time bounds when cancelling an exception.
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            calendarId,
            status: "cancelled",
            start: instance.start,
            end: instance.end,
            ...(instance.originalStartTime && {
              originalStartTime: instance.originalStartTime,
            }),
            ...(instance.recurringEventId && {
              recurringEventId: instance.recurringEventId,
            }),
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
    }).pipe(Effect.asVoid);

  const deleteEventAll = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);

      const isRecurring = Boolean(
        instance.recurringEventId || instance.recurrence?.length
      );

      let masterId = eventId;
      if (instance.recurringEventId) {
        const master = yield* getMasterRecurrence(calendarId, instance);
        masterId = master.id;
      } else if (!isRecurring) {
        return yield* Effect.tryPromise({
          try: () => client.calendars.events.delete(eventId, { calendarId }),
          catch: (cause) => new GoogleApiError({ cause }),
        }).pipe(Effect.asVoid);
      }

      return yield* Effect.tryPromise({
        try: () => client.calendars.events.delete(masterId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(Effect.asVoid);
    });

  const deleteEventFollowing = (calendarId: string, eventId: string) =>
    Effect.gen(function* () {
      const instance = yield* getEvent(calendarId, eventId);
      if (!(instance.recurringEventId || instance.recurrence?.length)) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error(
              "Cannot use recurrence scope for a non-recurring event"
            ),
          })
        );
      }
      const { master, originalStart } = yield* followingSplit(
        calendarId,
        instance
      );
      if (isWholeSeries(instance, master)) {
        return yield* deleteEventAll(calendarId, master.id);
      }
      const recurrence = truncateRecurrenceForFollowing({
        originalStart,
        recurrence: master.recurrence ?? [],
        seriesStart: master.start,
        seriesZone: seriesZoneOf(master),
      });
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({ ...master, recurrence }),
            calendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });
    }).pipe(Effect.asVoid);

  const deleteEvent = Effect.fn("GoogleCalendar.deleteEvent")(function* (
    calendarId: string,
    eventId: string,
    scope: RecurrenceScope
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan("scope", scope);
    switch (scope) {
      case "this":
        return yield* deleteEventThis(calendarId, eventId);
      case "all":
        return yield* deleteEventAll(calendarId, eventId);
      case "following":
        return yield* deleteEventFollowing(calendarId, eventId);
      default:
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
        );
    }
  });

  const moveSingleEvent = Effect.fn("GoogleCalendar.moveSingleEvent")(
    function* (
      calendarId: string,
      eventId: string,
      destinationCalendarId: string
    ) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      yield* Effect.annotateCurrentSpan("eventId", eventId);
      yield* Effect.annotateCurrentSpan(
        "destinationCalendarId",
        destinationCalendarId
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.move(eventId, {
            calendarId,
            destination: destinationCalendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsed = EventSchema.safeParse(response);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      return parsed.data;
    }
  );

  /**
   * Moves a series from one of its occurrences on to another calendar: a
   * new series there starts at that occurrence's original slot, with the
   * series' fields and length, and it and later changed occurrences keep
   * their changes; the old series ends before it.
   */
  const moveFollowingEvents = Effect.fn("GoogleCalendar.moveFollowingEvents")(
    function* (
      calendarId: string,
      instance: Event,
      destinationCalendarId: string
    ) {
      const { master, originalStart } = yield* followingSplit(
        calendarId,
        instance
      );
      if (isWholeSeries(instance, master)) {
        return yield* moveSingleEvent(
          calendarId,
          master.id,
          destinationCalendarId
        );
      }
      const blocked = splitBlockedError(master, originalStart);
      if (blocked) {
        return yield* Effect.fail(blocked);
      }
      const zone = seriesZoneOf(master);
      const slot = seriesSlotAt(master, originalStart);
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        cancelled: exceptions.cancelled,
        edited: undefined,
        master,
        originalStart,
        start: slot.start,
      });
      const carried = placeCarried({
        occurrences: [
          instance,
          ...exceptions.changed.map(({ occurrence }) => occurrence),
        ].map((occurrence) => {
          const at = originalStartOf(occurrence, zone) ?? originalStart;
          return {
            at,
            changes: changesOwnTo(occurrence, master, zone),
            originalStart: at,
          };
        }),
        recurrence,
        // One occurrence can't move to another calendar.
        seriesOnly: true,
        start: slot.start,
        zone,
      });
      if (!Array.isArray(carried)) {
        return yield* Effect.fail(refused(carried));
      }
      return yield* splitSeries({
        calendarId,
        carried,
        destinationCalendarId,
        master,
        newSeries: sanitizeEventPayload({ ...master, ...slot, recurrence }),
        originalStart,
      });
    }
  );

  const moveEvent = Effect.fn("GoogleCalendar.moveEvent")(function* (
    calendarId: string,
    eventId: string,
    destinationCalendarId: string,
    scope: RecurrenceScope
  ) {
    yield* Effect.annotateCurrentSpan("calendarId", calendarId);
    yield* Effect.annotateCurrentSpan("eventId", eventId);
    yield* Effect.annotateCurrentSpan(
      "destinationCalendarId",
      destinationCalendarId
    );
    yield* Effect.annotateCurrentSpan("scope", scope);
    if (scope === "this") {
      return yield* moveSingleEvent(calendarId, eventId, destinationCalendarId);
    }

    const instance = yield* getEvent(calendarId, eventId);

    const isRecurring = Boolean(
      instance.recurringEventId || instance.recurrence?.length
    );
    if (!isRecurring) {
      return yield* Effect.fail(
        new GoogleApiError({
          cause: new Error(
            "Cannot use recurrence scope for a non-recurring event"
          ),
        })
      );
    }

    if (scope === "all") {
      const master = yield* getMasterRecurrence(calendarId, instance);
      return yield* moveSingleEvent(
        calendarId,
        master.id,
        destinationCalendarId
      );
    }

    if (scope === "following") {
      return yield* moveFollowingEvents(
        calendarId,
        instance,
        destinationCalendarId
      );
    }

    return yield* Effect.fail(
      new GoogleApiError({ cause: new Error("Invalid recurrence scope") })
    );
  });

  const listColors = Effect.fn("GoogleCalendar.listColors")(function* () {
    const response = yield* Effect.tryPromise({
      try: () => client.listColors.listColors(),
      catch: (cause) => new GoogleApiError({ cause }),
    });

    const parsed = ColorsSchema.safeParse(response);
    if (!parsed.success) {
      return yield* Effect.fail(
        new GoogleCalendarZodError({ cause: parsed.error })
      );
    }

    return parsed.data;
  });

  const getMasterRecurrence = Effect.fn("GoogleCalendar.getMasterRecurrence")(
    function* (calendarId: string, event: Event) {
      yield* Effect.annotateCurrentSpan("calendarId", calendarId);
      const parsed = EventSchema.safeParse(event);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }

      const recurringEventId = parsed.data.recurringEventId;
      if (!recurringEventId) {
        if (!parsed.data.recurrence) {
          return yield* Effect.fail(
            new GoogleApiError({
              cause: new Error("Event is not a recurring event"),
            })
          );
        }
        return parsed.data;
      }

      const master = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.retrieve(recurringEventId, { calendarId }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const parsedMaster = EventSchema.safeParse(master);
      if (!parsedMaster.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsedMaster.error })
        );
      }

      return parsedMaster.data;
    }
  );

  return {
    listCalendars,
    listCalendarIds,
    getCalendar,
    createCalendar,
    updateCalendar,
    deleteCalendar,
    listEvents,
    getEvent,
    createEvent,
    updateEvent,
    moveEvent,
    deleteEvent,
    listColors,
    watchCalendarList,
    watchCalendarEvents,
    stopWatch,
    getMasterRecurrence,
  };
}

// -- Layer --

export const GoogleCalendarLive = (accessToken: string) =>
  Layer.succeed(GoogleCalendar, makeGoogleCalendarService(accessToken));
