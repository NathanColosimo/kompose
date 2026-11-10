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
 * Whether the series' new times give `occurrence`, changed on its own,
 * all it changed: only its times, to those of the new series' meeting on
 * its day (its date, made all day). Google cancels it when the series'
 * start moves, and that meeting takes its place.
 */
function newTimesKeep(params: {
  /** The fields the edit changed, which the new series' meeting takes. */
  changes: Partial<CreateEvent>;
  master: Event;
  occurrence: Event;
  originalStart: string;
  recurrence: string[];
  times: { end: Event["end"]; start: Event["start"] };
}): boolean {
  const { master, occurrence, originalStart, recurrence, times } = params;
  const slot = placeOnNewStart(originalStart, master, times.start);
  if (!slot) {
    return false;
  }
  const zone = repeatZone(master, times.start);
  const seriesZone = seriesZoneOf(master);
  const meeting = seriesSlotAt(times, slot);
  // Times of its own only if it was moved off its slot (or given its own
  // length); one at its slot follows the series to the new time. One
  // moved to the new meeting's start, at the series' length, keeps its
  // start there, and its length was the series' to change.
  const ownTimes = "start" in changesOwnTo(occurrence, master, seriesZone);
  const ownLength = !sameLength(occurrence, master, seriesZone);
  const timesAtStake =
    ownTimes && (ownLength || !sameTime(occurrence.start, meeting.start, zone));
  const own = Object.keys(ownChanges(occurrence, master, meeting, zone)).filter(
    (field) => timesAtStake || !(field === "start" || field === "end")
  );
  return (
    seriesMeetsAt({
      recurrence,
      seriesZone: zone,
      slot,
      start: times.start,
    }) === true &&
    own.every(
      // A value the edit gives the whole series (a cleared one too) is the
      // new meeting's too.
      (field) => {
        // Object.keys loses the key type: each is a CreateEvent field.
        const value = params.changes[field as keyof CreateEvent];
        return (
          Object.hasOwn(params.changes, field) &&
          Object.keys(changedFields({ [field]: value }, occurrence)).length ===
            0
        );
      }
    )
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
 * A rule meeting's place once the series starts at `start` (it meets once
 * a day): its own day at the new time, or its date made all day. Null if
 * it doesn't parse.
 */
function placeOnNewStart(
  slot: string,
  master: Event,
  start: Event["start"]
): string | null {
  const day = dayOfStart(asStart(slot), seriesZoneOf(master));
  const repeatsIn = repeatZone(master, start);
  const clock = clockOf(start, repeatsIn);
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
 * Whether the saved series has `place`, or ends before it: a meeting past
 * its new end goes with the rest, not lost.
 */
function keptOrEnded(params: {
  master: Event;
  place: string;
  recurrence: string[];
  start: Event["start"];
}): boolean {
  const { master, place, start } = params;
  // Read without skips (the save's own skip for it is already there) and
  // without its end: a rule meets past its end wherever it would have.
  const unbounded = params.recurrence
    .filter((line) => line.startsWith("RRULE:"))
    .map(withoutEnd);
  return (
    seriesMeetsAt({
      recurrence: unbounded,
      seriesZone: repeatZone(master, start),
      slot: place,
      start,
    }) === true
  );
}

/**
 * Where the occurrences deleted on their own (`cancelled`, original
 * starts) are skipped once a series that meets once a day starts at
 * `start`: a rule's meeting at its place there (`placeOnNewStart`); an
 * added (RDATE) one where it was, unless the series changes form.
 */
function deletedSlots(params: {
  cancelled: string[];
  master: Event;
  start: Event["start"];
}): string[] {
  const { cancelled, master, start } = params;
  const keepsForm = Boolean(master.start.date) === Boolean(start.date);
  if (keepsForm && !timeOfDayChange(master, start)) {
    return cancelled;
  }
  return cancelled.map((slot) =>
    ruleMeetingAt(slot, master) || !keepsForm
      ? (placeOnNewStart(slot, master, start) ?? slot)
      : slot
  );
}

/**
 * The rule meetings deleted on their own, or, after a day move, skipped in
 * the rule (EXDATE) by a skip the save sends as it was, whose place after
 * a new start (where `deletedSlots` skips them) isn't one of the saved
 * series': after a first meeting's day move under a rule whose days follow
 * its start (monthly on the start's date, say), the meeting now in its
 * place would come back. A skip the client moved or dropped was placed by
 * it; one on a start that keeps its day stays on its meeting's day.
 */
function deletedLost(params: {
  cancelled: string[];
  master: Event;
  recurrence: string[];
  /** The rules the save sends; left out, the series' own. */
  saved: string[] | undefined;
  times: { end: Event["end"]; start: Event["start"] };
}): string[] {
  const { master, recurrence, times } = params;
  const zone = seriesZoneOf(master);
  const own = master.recurrence ?? [];
  const sent = new Set(
    dateValues(params.saved ?? own, "EXDATE", zone).map(skipKey)
  );
  const day = newStartDay(master, times.start);
  const movesDay = !day?.equals(dayOfStart(master.start, zone) ?? day);
  const ruleSkips = dateValues(movesDay ? own : [], "EXDATE", zone)
    .filter((value) => sent.has(skipKey(value)))
    .map((value) =>
      value.instant
        ? googleDateTime(value.instant.toZonedDateTimeISO(zone))
        : value.day.toString()
    );
  const first = momentOf(times.start, repeatZone(master, times.start));
  return [...new Set([...params.cancelled, ...ruleSkips])].filter((slot) => {
    const place = ruleMeetingAt(slot, master)
      ? placeOnNewStart(slot, master, times.start)
      : null;
    const at =
      place && momentOf(asStart(place), repeatZone(master, times.start));
    // Before the new start, the series has no meeting to bring back.
    if (!(place && at && first) || Temporal.Instant.compare(at, first) < 0) {
      return false;
    }
    return !keptOrEnded({ master, place, recurrence, start: times.start });
  });
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
  changes: Partial<CreateEvent>;
  edited: CreateEvent;
  master: Event;
  opened: Event;
  times: { end: Event["end"]; start: Event["start"] };
}): { carried: Partial<CreateEvent>; lost: string[] } {
  const { master, times } = params;
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
      Object.entries(own).filter(([field]) => !(field in params.changes))
    );
    if (occurrence.id === params.opened.id) {
      carried = {
        ...fields,
        end: inSeriesZone(params.edited.end, master.end),
        start: inSeriesZone(params.edited.start, master.start),
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
 * `rule` without a skip at the series' `start` moved to another day that
 * the save didn't add (`saved`, the rules it sends): one the series had
 * there, or one placed there for a deleted meeting, was another meeting's
 * (a Wednesday deleted, the first Monday moved onto it), and the meeting
 * just placed there stays. A skip the save adds there is the user's; on
 * the start's own day, a skip there is the first meeting's.
 */
function withoutOwnSkipAt(
  rule: string[],
  master: Event,
  start: Event["start"],
  saved: string[] | undefined
): string[] {
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
    dateValues(saved ?? [], "EXDATE", zone).some(onStart) &&
    !dateValues(master.recurrence ?? [], "EXDATE", zone).some(onStart);
  return added
    ? rule
    : keepingDateValues(rule, "EXDATE", zone, (value) => !onStart(value));
}

/**
 * What an Entire series save writes of `rule` once the occurrences changed
 * or deleted on their own are read, and what it carries of the first
 * meeting when it ends the repeat (`endedRepeat`); or why it's refused.
 */
function keptAfterEdit(params: {
  cancelled: string[];
  changed: { occurrence: Event; originalStart: string }[];
  changes: Partial<CreateEvent>;
  edited: CreateEvent;
  master: Event;
  movesSlots: boolean;
  /** Whether the save moves the series' start (`updateEventAll`). */
  movesStart: boolean;
  opened: Event;
  rule: string[];
  times: { end: Event["end"]; start: Event["start"] };
}): SeriesRefusal | { carried: Partial<CreateEvent>; recurrence: string[] } {
  const { cancelled, master, rule, times } = params;
  if (!repeats(rule)) {
    const { carried, lost } = endedRepeat(params);
    return lost.length > 0
      ? unsureWhere(
          naming("dropsChangedOccurrences", lost, true),
          params.master.recurrence ?? []
        )
      : { carried, recurrence: [] };
  }
  const zone = seriesZoneOf(master);
  const recurrence = params.movesStart
    ? withoutOwnSkipAt(
        skipping(
          rule,
          deletedSlots({ cancelled, master, start: times.start }),
          zone
        ),
        master,
        times.start,
        params.edited.recurrence
      )
    : rule;
  return (
    seriesChangeRefusal({
      ...params,
      recurrence,
      saved: params.edited.recurrence,
    }) ?? { carried: {}, recurrence }
  );
}

/**
 * Why an Entire series write would cost the occurrences changed on their
 * own (`changed`) their changes; null if it wouldn't. Google ties each to
 * its original slot: it cancels all of them when the series' start moves
 * (one the new series meets at its own times loses nothing), and each
 * whose slot the new rule drops. A length-only change keeps them but gives
 * each the new length (the opened one takes the edit's, and one that
 * already has it loses nothing, so neither is counted).
 */
function seriesChangeRefusal(params: {
  /** The occurrences deleted on their own, by original start. */
  cancelled: string[];
  changed: { occurrence: Event; originalStart: string }[];
  /** The fields the edit changed, as the series is written with them. */
  changes: Partial<CreateEvent>;
  /** The form as sent, for what the opened occurrence was given. */
  edited: CreateEvent;
  master: Event;
  /** Whether the start or the rule changes (else only the length). */
  movesSlots: boolean;
  /** Whether the save moves the series' start. */
  movesStart: boolean;
  opened: Event;
  recurrence: string[];
  /** The rules the save sends; left out, the series' own. */
  saved: string[] | undefined;
  times: { end: Event["end"]; start: Event["start"] };
}): SeriesRefusal | null {
  const { changed, master, movesSlots, movesStart, opened, recurrence, times } =
    params;
  const zone = seriesZoneOf(master);
  const seriesOnly = givesNewRepeat({
    from: master.start,
    master,
    saved: params.saved,
    start: times.start,
  });
  const lost = changed
    .filter(({ occurrence, originalStart }) => {
      if (movesStart && occurrence.id === opened.id) {
        // The edit replaces its time and the fields it changes, but not a
        // day of its own, which Google would give back to the series,
        // unless it's the first meeting and the series moves to its day.
        const ownDay = dayOfStart(occurrence.start, zone);
        const first = opensSeries(occurrence, master);
        const newDay = newStartDay(master, times.start);
        // A first meeting whose day the series takes, or is given, keeps it.
        const firstDayKept =
          first &&
          (ownDay?.equals(newDay ?? ownDay) ||
            !newDay?.equals(dayOfStart(master.start, zone) ?? newDay));
        const movedDay = !(
          firstDayKept ||
          ownDay?.equals(dayOfStart(asStart(originalStart), zone) ?? ownDay)
        );
        // The saved series must still meet in its place (the first
        // meeting's is the new start, unless the save skips it).
        const repeatsIn = repeatZone(master, times.start);
        const startSlot = slotOf(times.start, repeatsIn);
        const place = first
          ? startSlot
          : placeOnNewStart(originalStart, master, times.start);
        // Read with the saved end and skips: the opened one isn't past an
        // end the save sets, which would drop it.
        const meetsThere =
          place !== null &&
          seriesMeetsAt({
            recurrence,
            seriesZone: repeatsIn,
            slot: place,
            start: times.start,
          });
        // An exclusion rule may drop even the series' start.
        const replaced = meetsThere === true;
        // A field of its own the series takes is kept only when the series
        // is written with what the form gave it (a guest list merged into
        // the series' own isn't).
        const takes = (field: keyof CreateEvent) =>
          field in params.changes &&
          Object.keys(
            changedFields({ [field]: params.changes[field] }, {
              ...occurrence,
              ...params.edited,
            } as Event)
          ).length === 0;
        return (
          movedDay ||
          !replaced ||
          Object.keys(changesOwnTo(occurrence, master, zone)).some(
            (field) =>
              field !== "start" &&
              field !== "end" &&
              // Object.keys loses the key type: each is a CreateEvent field.
              !takes(field as keyof CreateEvent)
          )
        );
      }
      if (movesStart) {
        return !newTimesKeep({
          changes: params.changes,
          master,
          occurrence,
          originalStart,
          recurrence,
          times,
        });
      }
      return (
        movesSlots &&
        seriesMeetsAt({
          recurrence,
          seriesZone: repeatZone(master, times.start),
          slot: originalStart,
          start: times.start,
        }) !== true
      );
    })
    .map(({ originalStart }) => originalStart);
  // A new repeat places its meetings anew, a deleted one's place too:
  // only the series' own rule, moved, can bring one back.
  if (movesStart && !seriesOnly) {
    lost.push(...deletedLost(params));
  }
  if (lost.length > 0) {
    const refusal = naming("dropsChangedOccurrences", lost, seriesOnly);
    const lines = [...(master.recurrence ?? []), ...recurrence];
    // A new start cancels them whatever the rule says; only whether one is
    // replaced (an exclusion rule may drop it) can be unsure then.
    return unsureWhere(
      refusal,
      movesStart ? lines.filter((line) => line.startsWith("EXRULE")) : lines
    );
  }
  if (sameLength(times, master, zone)) {
    return null;
  }
  const resized = changed
    .filter(
      ({ occurrence }) =>
        occurrence.id !== opened.id &&
        !sameLength(occurrence, master, zone) &&
        !sameLength(occurrence, times, zone)
    )
    .map(({ originalStart }) => originalStart);
  return resized.length > 0
    ? naming("resizesChangedOccurrences", resized, seriesOnly)
    : null;
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
   * The rule an Entire series save writes, once what it would cost the
   * occurrences changed or deleted on their own is checked: a deleted one
   * stays deleted as a skip where its meeting now is (`deletedSlots`), as
   * Google brings it back when the start moves; one changed whose changes
   * Google would undo is refused before writing (`seriesChangeRefusal`).
   * A save that ends the repeat carries the first meeting's own changes
   * into the event left (`endedRepeat`).
   */
  const keptOccurrences = (params: {
    calendarId: string;
    changes: Partial<CreateEvent>;
    edited: CreateEvent;
    master: Event;
    /** Whether the save moves the series' start. */
    movesStart: boolean;
    opened: Event;
    times: { end: Event["end"]; start: Event["start"] };
  }) =>
    Effect.gen(function* () {
      const { master, times } = params;
      const zone = seriesZoneOf(master);
      const rule = params.edited.recurrence
        ? withSeriesSkips(params.edited.recurrence, master)
        : (master.recurrence ?? []);
      // Read for what it means: the series' own skips, written again in
      // another form, aren't a new rule.
      const movesSlots =
        params.movesStart ||
        recurrenceValues(rule, zone) !==
          recurrenceValues(master.recurrence ?? [], zone);
      if (!(movesSlots || !sameLength(times, master, zone))) {
        return { carried: {}, recurrence: rule };
      }
      const { cancelled, changed } = yield* exceptionsOf(
        params.calendarId,
        master
      );
      const kept = keptAfterEdit({
        ...params,
        cancelled,
        changed,
        movesSlots,
        rule,
      });
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

      // Worked out once: which refusal applies, where skips go and whether
      // the opened occurrence gets its own write all turn on it.
      const movesStart = !sameTime(times.start, master.start, zone);
      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None").
      const { carried, recurrence } = yield* keptOccurrences({
        calendarId,
        // As the series is written: a guest list merged into its own.
        changes: changes.attendees
          ? { ...changes, attendees: event.attendees }
          : changes,
        edited,
        master,
        movesStart,
        opened: currentEvent,
        times,
      });

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
