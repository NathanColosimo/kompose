import { Context, Effect, Layer, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  repeats,
  sanitizeEventPayload,
  seriesMeetsAt,
  skipKey,
  skipping,
  truncateRecurrenceForFollowing,
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
import { meetsSeveralTimesADay, ruleDayCount } from "./series";
import {
  canonicalRule,
  changedFields,
  keepsTimes,
  type NamingRefusal,
  newRepeat,
  ownChanges,
  refusalMessage,
  type SeriesRefusal,
  SeriesRefusalSchema,
  sameLength,
  sameTime,
  seriesAttendees,
  withAnswersOf,
} from "./series-edits";
import {
  seriesSlotAt,
  seriesTimesForEdit,
  seriesZoneOf,
  slotOf,
} from "./series-times";
import {
  clockOf,
  clockTurn,
  DATE_ONLY,
  dateValues,
  dayOfStart,
  googleDateTime,
  keepingDateValues,
  lengthMs,
  momentOf,
  type RecurrenceValue,
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
  const rules = (edited.recurrence ?? master.recurrence ?? []).filter((line) =>
    line.startsWith("RRULE:")
  );
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
      .map((value) =>
        value.instant
          ? googleDateTime(value.instant.toZonedDateTimeISO(zone))
          : value.day.toString()
      ),
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
      recurrence: (master.recurrence ?? []).filter((line) =>
        line.startsWith("RRULE:")
      ),
      seriesZone: seriesZoneOf(master),
      slot,
      start: master.start,
    }) === true
  );
}

/**
 * Where an occurrence's place (`slot`, its original start) is once the
 * series is written as `plan` says: moved as its start moved round the
 * clock (`clockTurn`: 23:00 to the next day's 00:30 puts each a day on,
 * 9:00 to the next day's 8:00 keeps each on its own day); its date when
 * the series is made all day, and its own date at the new time when it's
 * made timed (a series that meets once a day). Null if it doesn't parse.
 */
function placeIn(slot: string, plan: SeriesPlan): string | null {
  const { master, times } = plan;
  const zone = seriesZoneOf(master);
  const repeatsIn = repeatZone(master, times.start);
  const wall = (time: Event["start"], timeZone: string) =>
    momentOf(time, timeZone)?.toZonedDateTimeISO(timeZone).toPlainDateTime();
  const at = wall(asStart(slot), zone);
  if (!at) {
    return null;
  }
  const to = wall(times.start, repeatsIn);
  if (!(to && times.start.dateTime)) {
    return at.toPlainDate().toString();
  }
  const from = master.start.dateTime && wall(master.start, zone);
  // Made timed, it has no old time of day: its own date at the new time.
  if (!from) {
    return googleDateTime(
      at.toPlainDate().toZonedDateTime({
        plainTime: to.toPlainTime(),
        timeZone: repeatsIn,
      })
    );
  }
  return googleDateTime(
    at.add(clockTurn({ from, to })).toZonedDateTime(repeatsIn)
  );
}

/**
 * The first meeting's own fields (`own`, its times aside) the event left
 * by "Repeat: None" keeps: those the save doesn't set, and guests of its
 * own with the save's guest change applied to them, not the series' list,
 * as the event left is this meeting.
 */
function firstMeetingFields(params: {
  occurrence: Event;
  own: Partial<CreateEvent>;
  plan: SeriesPlan;
}): Partial<CreateEvent> {
  const { occurrence, own } = params;
  const { changes, edited, opened } = params.plan;
  const fields: Partial<CreateEvent> = Object.fromEntries(
    Object.entries(own).filter(([field]) => !(field in changes))
  );
  // Cleared on its own, its guests read as none (`attendees: undefined`).
  if ("attendees" in own && changes.attendees) {
    fields.attendees = seriesAttendees({
      edited: edited.attendees ?? [],
      occurrence: opened.attendees,
      series: occurrence.attendees,
    });
  }
  return fields;
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
  first: Event | undefined;
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
    const fields = firstMeetingFields({ occurrence, own, plan: params.plan });
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
  // A guest's own answer to the first meeting (one who declined it alone)
  // is that meeting's, which the event left keeps: Google drops it with
  // the repeat.
  const answered = withAnswersOf({
    guests: carried.attendees ?? changes.attendees ?? master.attendees,
    occurrence: params.first,
  });
  if (answered) {
    carried = { ...carried, attendees: answered };
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
      recurrence: plan.recurrence
        .filter((line) => line.startsWith("RRULE:"))
        .map(withoutEnd),
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
      originalStart: value.instant
        ? googleDateTime(value.instant.toZonedDateTimeISO(zone))
        : value.day.toString(),
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
  /** The first meeting's own occurrence, if it has one (its guests' answers). */
  first: Event | undefined;
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
 * `master`'s exceptions in Google's listing: the cancelled ones' original
 * starts, and the moved or edited ones the series still meets in the place
 * of (one Google detached, its slot gone, has no changes at stake; one
 * an exclusion rule may have dropped counts).
 */
function sortExceptions(events: SeriesListing[], master: Event) {
  const zone = seriesZoneOf(master);
  const cancelled: string[] = [];
  const changed: { occurrence: Event; originalStart: string }[] = [];
  const firstSlot = slotOf(master.start, zone);
  let first: Event | undefined;
  for (const event of events) {
    const originalStart =
      event.recurringEventId === master.id && event.originalStartTime
        ? slotOf(event.originalStartTime, zone)
        : null;
    if (!originalStart) {
      continue;
    }
    if (event.status === "cancelled" || !("start" in event)) {
      cancelled.push(originalStart);
      continue;
    }
    if (originalStart === firstSlot) {
      first = event;
    }
    if (
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
  return { cancelled, changed, first };
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

/** `occurrence`'s own changes (see `ownChanges`), from its original start. */
function changesOwnTo(
  occurrence: Event,
  master: Event,
  zone: string
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
  return ownChanges(
    occurrence,
    master,
    seriesSlotAt(master, originalStart),
    zone
  );
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
  operation: "create" | "update";
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

  /**
   * `master`'s exceptions, sorted by `sortExceptions`. Listed by iCalUID,
   * which returns only the master and its exceptions, so an endless
   * series isn't expanded.
   */
  const exceptionsOf = (calendarId: string, master: Event) =>
    Effect.gen(function* () {
      const iCalUID = master.iCalUID;
      if (!iCalUID) {
        // Google gives every event one; without it the exceptions can't
        // be checked, so nothing is written.
        return yield* Effect.fail(
          new GoogleApiError({ cause: new Error("Series has no iCalUID") })
        );
      }
      const items: unknown[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.list(calendarId, {
              iCalUID,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        items.push(...(response.items ?? []));
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      const parsed = SeriesListingSchema.safeParse(items);
      if (!parsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: parsed.error })
        );
      }
      return sortExceptions(parsed.data, master);
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
      const { cancelled, changed, first } = yield* exceptionsOf(
        calendarId,
        master
      );
      const kept = afterSave({ cancelled, changed, first, plan });
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

  const updateEventFollowing = (
    calendarId: string,
    event: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      const master = yield* getMasterRecurrence(calendarId, currentEvent);
      if (!master.recurrence) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const startIso =
        currentEvent.originalStartTime?.dateTime ??
        currentEvent.originalStartTime?.date ??
        currentEvent.start.dateTime ??
        currentEvent.start.date;
      const masterStartIso = master.start.dateTime ?? master.start.date;

      if (!(startIso && masterStartIso)) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(startIso);
      const masterStart = new Date(masterStartIso);

      // First occurrence → "following" is the same as "all"
      if (occurrenceStart.getTime() <= masterStart.getTime()) {
        return yield* updateEventAll(calendarId, event, currentEvent, master);
      }

      const originalRecurrence = [...master.recurrence];
      const recurrence = event.recurrence?.length
        ? event.recurrence
        : master.recurrence;

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      const truncatedPayload = sanitizeEventPayload({
        ...master,
        recurrence: truncatedRecurrence,
      });
      yield* Effect.annotateCurrentSpan(
        "eventType",
        truncatedPayload.eventType ?? "default"
      );
      const truncatedConferenceDataVersion = writeOptions(
        truncatedPayload,
        {}
      ).conferenceDataVersion;

      const truncateMasterResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...truncatedPayload,
            calendarId,
            ...(truncatedConferenceDataVersion
              ? { conferenceDataVersion: truncatedConferenceDataVersion }
              : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "update",
            calendarId,
            eventId: master.id,
            scope: "following-truncate",
            event: truncatedPayload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      });

      yield* parseEventResponse(truncateMasterResponse);

      const newSeriesPayload = sanitizeEventPayload({
        ...master,
        ...event,
        recurrence,
      });
      const newSeriesConferenceDataVersion = writeOptions(
        newSeriesPayload,
        {}
      ).conferenceDataVersion;

      const restorePayload = sanitizeEventPayload({
        ...master,
        recurrence: originalRecurrence,
      });
      const restoreConferenceDataVersion = writeOptions(
        restorePayload,
        {}
      ).conferenceDataVersion;

      const restoreMasterRecurrence = Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...restorePayload,
            calendarId,
            ...(restoreConferenceDataVersion
              ? { conferenceDataVersion: restoreConferenceDataVersion }
              : {}),
          }),
        catch: (restoreCause) => new GoogleApiError({ cause: restoreCause }),
      }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.asVoid
      );

      const createResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(calendarId, {
            ...newSeriesPayload,
            ...(newSeriesConferenceDataVersion
              ? { conferenceDataVersion: newSeriesConferenceDataVersion }
              : {}),
          }),
        catch: (cause) => {
          logGoogleEventUpdateFailure({
            operation: "create",
            calendarId,
            event: newSeriesPayload,
            cause,
          });
          return new GoogleApiError({ cause });
        },
      }).pipe(
        Effect.catch((createError) =>
          // Best-effort rollback; keep the create failure even if restoring recurrence fails.
          restoreMasterRecurrence.pipe(Effect.andThen(Effect.fail(createError)))
        )
      );

      return yield* parseEventResponse(createResponse);
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

      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const originalStartIso =
        instance.originalStartTime?.dateTime ??
        instance.originalStartTime?.date ??
        instance.start.dateTime ??
        instance.start.date;

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(originalStartIso);

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: truncatedRecurrence,
            }),
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
      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      const originalStartIso =
        instance.originalStartTime?.dateTime ??
        instance.originalStartTime?.date ??
        instance.start.dateTime ??
        instance.start.date;

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const occurrenceStart = new Date(originalStartIso);

      // 1) Cut off the original series up to the edited occurrence.
      const originalRecurrence = [...master.recurrence];
      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        occurrenceStart,
        Boolean(master.start.date)
      );

      const truncatedMasterResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: truncatedRecurrence,
            }),
            calendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      });

      const truncatedMasterParsed = EventSchema.safeParse(
        truncatedMasterResponse
      );
      if (!truncatedMasterParsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: truncatedMasterParsed.error })
        );
      }

      // 2) Create a new series in the destination calendar starting at this occurrence.
      const newSeriesPayload = sanitizeEventPayload({
        ...master,
        ...instance,
        start: instance.start,
        end: instance.end,
        recurrence: master.recurrence,
      });

      const restoreMasterRecurrence = Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...sanitizeEventPayload({
              ...master,
              recurrence: originalRecurrence,
            }),
            calendarId,
          }),
        catch: (restoreCause) => new GoogleApiError({ cause: restoreCause }),
      }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.asVoid
      );

      const createResponse = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.create(
            destinationCalendarId,
            newSeriesPayload
          ),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(
        Effect.catch((createError) =>
          // Best-effort rollback; keep the create failure even if restoring recurrence fails.
          restoreMasterRecurrence.pipe(Effect.andThen(Effect.fail(createError)))
        )
      );

      const createdParsed = EventSchema.safeParse(createResponse);
      if (!createdParsed.success) {
        return yield* Effect.fail(
          new GoogleCalendarZodError({ cause: createdParsed.error })
        );
      }

      return createdParsed.data;
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
