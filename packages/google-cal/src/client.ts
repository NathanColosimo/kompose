import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  APIConnectionError,
  ConflictError,
  NotFoundError,
} from "./api-client/core/error";
import {
  addsSlot,
  deleteFromListed,
  endsBeforeStart,
  followingDelete,
  followingIsWhole,
  followingSplitBlocked,
  repeats,
  sanitizeEventPayload,
  seriesMeetsAt,
  skipKey,
  skipping,
  splitAddedDays,
  truncateRecurrenceForFollowing,
} from "./recurrence-utils";
import { canReadRule, isRuleDay, samePlaceInPeriod } from "./rule-days";
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
import {
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
  meetsSeveralTimesADay,
  momentOf,
  type RecurrenceValue,
  readRecurrenceValue,
  SUB_DAILY,
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
    .map((line) => {
      const [name, parts = ""] = line.split(":");
      return `${name}:${parts.split(";").sort().join(";")}`;
    })
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
 * A refusal naming the occurrences (by original start) a save would cost,
 * marked when the save is one only a series takes.
 */
function naming(
  reason: NamingRefusal["reason"],
  originalStarts: readonly string[],
  seriesOnly: boolean
): NamingRefusal {
  return seriesOnly
    ? { originalStarts, reason, seriesOnly: true }
    : { originalStarts, reason };
}

/**
 * `refusal` marked `unsure` when a rule it was read against can't be read
 * here (an exclusion rule, or a day rule with parts not read): what it
 * names may keep its changes, but that can't be told.
 */
function unsureWhere(
  refusal: NamingRefusal,
  recurrence: string[]
): NamingRefusal {
  const unread = recurrence.some(
    (line) =>
      line.startsWith("EXRULE") ||
      (line.startsWith("RRULE:") && !SUB_DAILY.test(line) && !canReadRule(line))
  );
  return unread ? { ...refusal, unsure: true } : refusal;
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
  const day = dayOfStart(params.start, zone);
  const from = dayOfStart(params.from, zone);
  return newRepeat({
    moved: day && from && !from.equals(day) ? { from, to: day } : null,
    own: params.master.recurrence ?? [],
    saved: params.saved,
  });
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
 * Refuses "This and following" where a new series can't start: at an
 * added meeting, or in a series with several rules (the apps don't offer
 * it there either). Null when the split is fine.
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
  const day = dayOfStart(start, zone);
  const rulesMeet =
    !day ||
    rules.length === 0 ||
    rules.some((rule) => isRuleDay(rule, day, day) === true);
  // A day the opened meeting already had on its own isn't a new one.
  const movesDay = !day?.equals(dayOfStart(occurrence.start, zone) ?? day);
  if (opensSeries(occurrence, master) && rulesMeet && movesDay) {
    return { end: oneForm(end), start: oneForm(start) };
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
  return (
    seriesMeetsAt({
      recurrence,
      seriesZone: zone,
      slot,
      start: times.start,
    }) === true &&
    Object.keys(
      ownChanges(occurrence, master, seriesSlotAt(times, slot), zone)
    ).every(
      // A value the edit gives the whole series is the new meeting's too.
      (field) => {
        // Object.keys loses the key type: each is a CreateEvent field.
        const value = params.changes[field as keyof CreateEvent];
        return (
          value !== undefined &&
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

/**
 * A time in one form: a date when it has one (a form that toggled to all
 * day can keep its old date-time), else its date-time.
 */
function oneForm(time: Event["start"]): Event["start"] {
  return time.date
    ? { date: time.date }
    : { dateTime: time.dateTime, timeZone: time.timeZone };
}

/**
 * Whether the series' own rules (not an added day) meet at `slot`; null
 * when a rule can't be read.
 */
function ruleMeetingAt(slot: string, master: Event): boolean | null {
  return seriesMeetsAt({
    recurrence: (master.recurrence ?? []).filter((line) =>
      line.startsWith("RRULE:")
    ),
    seriesZone: seriesZoneOf(master),
    slot,
    start: master.start,
  });
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
  const seriesZone = repeatZone(master, start);
  // Read without skips: the save's own skip for it is already there.
  const rules = params.recurrence.filter((line) => line.startsWith("RRULE:"));
  const unbounded = rules.map(withoutEnd);
  const meets = (recurrence: string[]) =>
    seriesMeetsAt({ recurrence, seriesZone, slot: place, start }) === true;
  return meets(rules) || meets(unbounded);
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
    ruleMeetingAt(slot, master) === true || !keepsForm
      ? (placeOnNewStart(slot, master, start) ?? slot)
      : slot
  );
}

/**
 * The rule meetings deleted on their own whose place after a new start
 * (where `deletedSlots` skips them) isn't one of the saved series': after
 * a first meeting's day move under a rule whose days follow its start
 * (monthly on the start's date, say), the meeting now in its place would
 * come back.
 */
function deletedLost(params: {
  cancelled: string[];
  master: Event;
  recurrence: string[];
  times: { end: Event["end"]; start: Event["start"] };
}): string[] {
  const { master, recurrence, times } = params;
  const first = momentOf(times.start, repeatZone(master, times.start));
  return params.cancelled.filter((slot) => {
    const ruleMet = ruleMeetingAt(slot, master);
    const place =
      ruleMet === false ? null : placeOnNewStart(slot, master, times.start);
    const at =
      place && momentOf(asStart(place), repeatZone(master, times.start));
    // Before the new start, the series has no meeting to bring back.
    if (!(place && at && first) || Temporal.Instant.compare(at, first) < 0) {
      return false;
    }
    // A rule that can't be read can't tell where its meeting went: lost,
    // as a changed one there is.
    return (
      ruleMet === null ||
      !keptOrEnded({ master, place, recurrence, start: times.start })
    );
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
    // All its own changes, its times too even where the save sets times:
    // own times the save would override are lost (below).
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
  const day = dayOfStart(start, zone);
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
  const recurrence = sameTime(times.start, master.start, zone)
    ? rule
    : withoutOwnSkipAt(
        skipping(
          rule,
          deletedSlots({ cancelled, master, start: times.start }),
          zone
        ),
        master,
        times.start,
        params.edited.recurrence
      );
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
  /** The fields the edit changed. */
  changes: Partial<CreateEvent>;
  master: Event;
  /** Whether the start or the rule changes (else only the length). */
  movesSlots: boolean;
  opened: Event;
  recurrence: string[];
  /** The rules the save sends; left out, the series' own. */
  saved: string[] | undefined;
  times: { end: Event["end"]; start: Event["start"] };
}): SeriesRefusal | null {
  const { changed, master, movesSlots, opened, recurrence, times } = params;
  const zone = seriesZoneOf(master);
  const seriesOnly = givesNewRepeat({
    from: master.start,
    master,
    saved: params.saved,
    start: times.start,
  });
  const movesStart = !sameTime(times.start, master.start, zone);
  const lost = changed
    .filter(({ occurrence, originalStart }) => {
      if (movesStart && occurrence.id === opened.id) {
        // The edit replaces its time and the fields it changes, but not a
        // day of its own, which Google would give back to the series,
        // unless it's the first meeting and the series moves to its day.
        const ownDay = dayOfStart(occurrence.start, zone);
        const first = opensSeries(occurrence, master);
        const newDay = dayOfStart(times.start, zone);
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
        return (
          movedDay ||
          !replaced ||
          Object.keys(
            changesOwnTo(occurrence, master, zone, params.changes)
          ).some((field) => field !== "start" && field !== "end")
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
  const from = clockOf(master.start, zone);
  const was = clockOf(occurrence.start, zone);
  const now = clockOf(edited.start, zone);
  // Made all day, its times go too.
  const moves =
    timeOfDayChange(master, start) !== null ||
    Boolean(start.date) ||
    Boolean(was && now && !was.equals(now));
  return Boolean(
    from && moves && meetsSeveralTimesADay(master.recurrence ?? [], from)
  );
}

/** A slot's moment (a date's start, in `zone`); null if it doesn't parse. */
function slotMoment(slot: string, zone: string): Temporal.Instant | null {
  return momentOf(asStart(slot), zone);
}

/**
 * `master`'s exceptions in Google's listing, all or those after `after`
 * (an original start): the cancelled ones' original starts, and the moved
 * or edited ones the series still meets in the place of (one Google
 * detached, its slot gone, has no changes at stake; one whose rule can't
 * be read counts).
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
    if (!(originalStart && moment)) {
      continue;
    }
    if (from && Temporal.Instant.compare(moment, from) <= 0) {
      continue;
    }
    if (event.status === "cancelled" || !("start" in event)) {
      cancelled.push(originalStart);
    } else if (
      // One moved and moved back has nothing to keep.
      Object.keys(changesOwnTo(event, master, zone)).length > 0 &&
      seriesMeetsAt({
        recurrence: master.recurrence ?? [],
        seriesZone: zone,
        slot: originalStart,
        start: master.start,
      }) !== false
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

/** An occurrence's own changes to put back on a new series, and where. */
interface CarriedOccurrence {
  /** Its slot in the new series (its original start there). */
  at: string;
  changes: Partial<CreateEvent>;
}

/**
 * `occurrence`'s own changes (see `ownChanges`) less the fields `edited`
 * sets for its whole series, which the series carries.
 */
function changesOwnTo(
  occurrence: Event,
  master: Event,
  zone: string,
  /** Fields the edit sets for its whole series, left out. */
  edited: Partial<CreateEvent> = {}
): Partial<CreateEvent> {
  const originalStart = originalStartOf(occurrence, zone);
  if (!originalStart) {
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
 * Where a rule's occurrence of `master` at `slot` (an original start)
 * lands in a This and following new series from `splitStart`, starting at
 * `start` with `recurrence`: on its own day with the split's change of time
 * when the new series meets there (a rule day that didn't move), else as
 * many days on as the split moved (`placeInNewSeries`) when it meets
 * there, else, in a monthly or yearly series, at the meeting as many into
 * its month or year (`samePlaceInPeriod`); null when it meets at none, or
 * that can't be told.
 */
function carriedSlot(params: {
  master: Event;
  recurrence: string[];
  slot: string;
  splitStart: string;
  start: Event["start"];
}): string | null {
  const { master, recurrence, slot, start } = params;
  // The new series repeats in its start's zone (an all-day one made timed
  // takes the new start's).
  const zone = repeatZone(master, start);
  // A slot kept as it was meets, though a rule not read here can't say:
  // the new series repeats by that rule from one of its own meetings.
  const meets = (at: string) => {
    const read = seriesMeetsAt({
      recurrence,
      seriesZone: zone,
      slot: at,
      start,
    });
    return read === true || (read === null && at === slot);
  };
  const splitDay = dayOfStart(asStart(params.splitStart), zone);
  const ownDayStart = onDay(start, splitDay, zone);
  const ownDay =
    ownDayStart &&
    placeInNewSeries({
      newStart: ownDayStart,
      originalStart: slot,
      splitStart: params.splitStart,
      zone,
    });
  const moved = placeInNewSeries({
    newStart: start,
    originalStart: slot,
    splitStart: params.splitStart,
    zone,
  });
  // A new time less than a day off by the clock (23:30 to 00:30 the next
  // day) moves each meeting by as much, across midnight too; a longer move
  // keeps a rule day's meetings on their own day first. A day on across a
  // clock change (23 elapsed hours) is a day.
  const wall = (time: Event["start"]) =>
    momentOf(time, zone)?.toZonedDateTimeISO(zone).toPlainDateTime();
  const from = wall(asStart(params.splitStart));
  const to = wall(start);
  const shortMove = Boolean(
    from && to && Math.abs(from.until(to).total("hours")) < 24
  );
  for (const place of shortMove ? [moved, ownDay] : [ownDay, moved]) {
    if (place && meets(place)) {
      return place;
    }
  }
  const rulesOf = (lines: string[]) =>
    lines.filter((line) => line.startsWith("RRULE:"));
  const [oldRule, ...oldOthers] = rulesOf(master.recurrence ?? []);
  const [newRule, ...newOthers] = rulesOf(recurrence);
  const day = dayOfStart(asStart(slot), zone);
  const oldStart = dayOfStart(master.start, seriesZoneOf(master));
  const newStart = dayOfStart(start, zone);
  if (
    !(oldRule && newRule && day && oldStart && newStart && splitDay) ||
    oldOthers.length + newOthers.length > 0
  ) {
    return null;
  }
  const inPeriod = onDay(
    start,
    samePlaceInPeriod({
      day,
      newRule,
      newStart,
      oldRule,
      oldStart,
      split: splitDay,
    }),
    zone
  );
  const place = inPeriod && slotOf(inPeriod, zone);
  return place && meets(place) ? place : null;
}

/**
 * The rule's meeting on the split's own day at the new time, when the new
 * series meets there and starts on a day its rules don't meet (a Monday
 * moved to Sunday, Mondays kept). Google always meets at a series' start,
 * so that start is a meeting of its own, and the moved meeting would be
 * there twice.
 */
function movedOffRule(params: {
  master: Event;
  originalStart: string;
  recurrence: string[];
  start: Event["start"];
}): string[] {
  const { master, originalStart, recurrence, start } = params;
  const zone = repeatZone(master, start);
  const day = dayOfStart(start, zone);
  const rules = recurrence.filter((line) => line.startsWith("RRULE:"));
  if (
    !(day && rules.length > 0) ||
    rules.some((rule) => isRuleDay(rule, day, day) !== false)
  ) {
    return [];
  }
  const ownDay = onDay(
    start,
    dayOfStart(asStart(originalStart), seriesZoneOf(master)),
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
  const day = dayOfStart(asStart(slot), zone);
  const formed = onDay(start, day, zone);
  return formed && slotOf(formed, zone);
}

/**
 * The occurrences a "This and following" new series carries, and where:
 * the opened one at its start with its own changes (its times only if
 * the edit left them), and later changed ones at their new places.
 */
function followingOccurrences(params: {
  /** The fields the edit changed, which the new series carries. */
  changes: Partial<CreateEvent>;
  edited: CreateEvent;
  exceptions: { occurrence: Event; originalStart: string }[];
  master: Event;
  opened: Event;
  originalStart: string;
  /** The new series' rule. */
  recurrence: string[];
  /** The new series' start. */
  start: Event["start"];
}) {
  const { changes, master, originalStart, start } = params;
  const zone = seriesZoneOf(master);
  const own = changesOwnTo(params.opened, master, zone, changes);
  const { end: _end, start: _start, ...ownFields } = own;
  // A new end alone keeps the opened one's own start, now with that end.
  const keptStart = sameTime(params.edited.start, params.opened.start, zone);
  let openedChanges: Partial<CreateEvent> = ownFields;
  if (keepsTimes(params.edited, params.opened, zone)) {
    openedChanges = own;
  } else if (keptStart && own.start) {
    openedChanges = { ...own, end: params.edited.end };
  }
  return [
    {
      at: slotOf(start, zone),
      changes: openedChanges,
      opened: true as const,
      originalStart,
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
          master,
          originalStart,
          own: exceptionOwn,
          recurrence: params.recurrence,
          slot: exception.originalStart,
          start,
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
 * moves with the series, placed by day when the series is made all day or
 * timed. Its own times have no place in a series of the other form: null.
 */
function carriedAt(params: {
  master: Event;
  originalStart: string;
  own: Partial<CreateEvent>;
  recurrence: string[];
  slot: string;
  start: Event["start"];
}): string | null {
  const { master, own, slot, start } = params;
  const zone = seriesZoneOf(master);
  if (addsSlot(master.recurrence ?? [], slot, zone)) {
    return sameForm(slot, start);
  }
  if (!sameForm(slot, start) && (own.start || own.end)) {
    return null;
  }
  const newZone = repeatZone(master, start);
  return carriedSlot({
    master,
    recurrence: params.recurrence,
    slot: inFormOf(slot, start, newZone) ?? slot,
    splitStart:
      inFormOf(params.originalStart, start, newZone) ?? params.originalStart,
    start,
  });
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

/** `slot` when it has `start`'s form (a date, or a date-time); else null. */
function sameForm(slot: string, start: Event["start"]): string | null {
  return DATE_ONLY.test(slot) === Boolean(start.date) ? slot : null;
}

/**
 * The occurrences with changes a new series can carry. Google keeps an
 * occurrence's changes only at a slot its series meets at, so any without
 * one are refused by original start, before anything is written.
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
  // Each slot holds one occurrence: two that land on one can't both keep
  // their changes.
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
      at &&
      seriesMeetsAt({
        recurrence: params.recurrence,
        seriesZone: params.zone,
        slot: at,
        start: params.start,
      });
    // Kept on its own slot, it meets though a rule not read here can't say
    // (`carriedSlot`); a lookup on the new series checks it before the cut.
    const kept = meets === true || (meets === null && at === originalStart);
    const moment = at && kept ? slotMoment(at, params.zone) : null;
    const taken = moment && placed.get(moment.epochMilliseconds);
    // An added (RDATE) meeting the new series keeps holds its slot too.
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

function getConferenceDataVersion(event: {
  conferenceData?: unknown;
}): number | undefined {
  return event.conferenceData ? 1 : undefined;
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
   * Delete an event. `this` cancels one occurrence, `all` deletes the
   * series, `following` ends it before the occurrence. Only `following`
   * needs a series.
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
   * Move an event to another calendar. `this` moves one occurrence, `all`
   * the series, `following` ends it and starts a new one there. Scopes
   * other than `this` fail for an event that doesn't repeat.
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
    // Expanded series can span pages: ask for the most, follow tokens.
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
    const conferenceDataVersion = getConferenceDataVersion(event);
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
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      const payload = buildThisOccurrenceUpdatePayload(event, currentEvent);

      yield* Effect.annotateCurrentSpan(
        "eventType",
        payload.eventType ?? "default"
      );
      const conferenceDataVersion = getConferenceDataVersion(payload);
      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(eventId, {
            ...payload,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
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
   * The original starts of a series' occurrences, as Google lists them,
   * cancelled ones too (one rescheduled keeps its place). Only for a series
   * whose every rule ends, so the list does too.
   */
  const listOccurrenceStarts = (calendarId: string, master: Event) =>
    Effect.gen(function* () {
      const starts: string[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.instances(master.id, {
              calendarId,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        for (const item of response.items ?? []) {
          const start = item.originalStartTime ?? item.start;
          const slot = start && slotOf(start, seriesZoneOf(master));
          if (slot) {
            starts.push(slot);
          }
        }
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return starts;
    });

  /**
   * `master`'s exceptions, sorted by `sortExceptions`. Listed by iCalUID,
   * which returns only the master and its exceptions, so an endless
   * series isn't expanded.
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
      return sortExceptions(parsed.data, master, after);
    });

  /**
   * The rule a split's new part repeats with: `edited`, or the series'.
   * Occurrences `cancelled` after the split stay skipped where the new
   * series meets in their place, as changed ones are put back
   * (`carriedSlot`); an added one keeps its slot. Refuses, before any
   * write, if the rule ends before `start`.
   */
  const newSeriesRecurrence = (params: {
    cancelled: string[];
    edited: string[] | undefined;
    master: Event;
    originalStart: string;
    start: Event["start"];
  }) =>
    Effect.gen(function* () {
      const { master, originalStart, start } = params;
      const zone = seriesZoneOf(master);
      // Added days before the split stay with the old part.
      const fromSplit = splitAddedDays(
        savedRule(params.edited, master, params.cancelled),
        originalStart,
        zone,
        "from"
      );
      const isAdded = (slot: string) =>
        addsSlot(master.recurrence ?? [], slot, zone);
      const asSlot = (value: RecurrenceValue) =>
        value.instant
          ? googleDateTime(value.instant.toZonedDateTimeISO(zone))
          : value.day.toString();
      // The rule's own skips after the split go where their meetings go,
      // as deleted occurrences do; one the series didn't have was lined up
      // by the client and stays as written.
      const split = slotMoment(originalStart, zone);
      const had = new Set(
        dateValues(master.recurrence ?? [], "EXDATE", zone).map(skipKey)
      );
      const ownSkip = (value: RecurrenceValue) => {
        const slot = asSlot(value);
        const at = slotMoment(slot, zone);
        return (
          had.has(skipKey(value)) &&
          !isAdded(slot) &&
          Boolean(split && at && Temporal.Instant.compare(at, split) > 0)
        );
      };
      const ownSkips = dateValues(fromSplit, "EXDATE", zone)
        .filter(ownSkip)
        .map(asSlot);
      const rule = keepingDateValues(
        fromSplit,
        "EXDATE",
        zone,
        (value) => !ownSkip(value)
      );
      // A deleted or skipped rule meeting stays skipped where the new
      // series meets in its place, as a changed one is put back (read
      // without skips: a place already skipped is still its place, and in
      // the new start's form: made all day or timed, it's placed by day);
      // an added one keeps its slot. No skip lands on the new series'
      // start, the meeting the user just saved, or on an added meeting it
      // keeps.
      const unskipped = fromSplit.filter((line) => !line.startsWith("EXDATE"));
      // The new series' slots, in the zone it repeats in.
      const newZone = repeatZone(master, start);
      const startSlot = slotOf(start, newZone);
      const splitStart =
        inFormOf(originalStart, start, newZone) ?? originalStart;
      const placed = [...params.cancelled, ...ownSkips].flatMap((slot) => {
        const at = isAdded(slot)
          ? null
          : carriedSlot({
              master,
              recurrence: unskipped,
              slot: inFormOf(slot, start, newZone) ?? slot,
              splitStart,
              start,
            });
        const formed = inFormOf(at ?? slot, start, newZone);
        const ontoAdded =
          at !== null && formed !== null && addsSlot(fromSplit, formed, zone);
        return formed && formed !== startSlot && !ontoAdded ? [formed] : [];
      });
      const recurrence = skipping(
        rule,
        [
          ...placed,
          ...movedOffRule({
            master,
            originalStart,
            recurrence: fromSplit,
            start,
          }),
        ],
        zone
      );
      if (!endsBeforeStart(recurrence, momentOf(start, newZone), newZone)) {
        return recurrence;
      }
      // The series' own end before the new start (a meeting moved past
      // it): its rule is spent, so the new part has that meeting and any
      // added (RDATE) ones after it; one event if none. An end the save
      // sets there is refused.
      // Its own rule however it's written (parts reordered, its day rebuilt
      // for a day move): not a new end.
      const ownRule = !givesNewRepeat({
        from: asStart(originalStart),
        master,
        saved: params.edited,
        start,
      });
      if (ownRule) {
        const added = recurrence.filter((line) => !line.startsWith("RRULE:"));
        return repeats(added) ? added : [];
      }
      return yield* Effect.fail(refused({ reason: "endsBeforeStart" }));
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
      // Google changes or removes a meeting link only at version 1; one
      // the occurrence dropped on its own is a change too.
      const conferenceDataVersion =
        "conferenceData" in carried.changes
          ? 1
          : getConferenceDataVersion(payload);
      yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(occurrence.id, {
            ...payload,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
            // Google writes attachments only when asked to.
            ...("attachments" in carried.changes
              ? { supportsAttachments: true }
              : {}),
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
   * unchanged, the new one is deleted and the call fails; unread or
   * changed some other way, both stay (a meeting shown twice beats one
   * lost) and the call fails.
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
          if (cause instanceof NotFoundError) {
            return new GoogleApiError({ cause });
          }
          logGoogleEventUpdateFailure({
            operation: "delete",
            calendarId: destinationCalendarId,
            eventId: seriesId,
            scope: "following-rollback",
            event: newSeries,
            cause,
          });
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
      const conferenceDataVersion = getConferenceDataVersion(written);
      const created = yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.create(destinationCalendarId, {
              ...written,
              id: seriesId,
              ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
              // Google writes attachments only when asked to.
              ...(written.attachments?.length
                ? { supportsAttachments: true }
                : {}),
            }),
          catch: (cause) => {
            logGoogleEventUpdateFailure({
              operation: "create",
              calendarId: destinationCalendarId,
              event: written,
              cause,
            });
            return new GoogleApiError({ cause });
          },
        }).pipe(
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

      const cutRecurrence = truncateRecurrenceForFollowing(
        master.recurrence ?? [],
        params.originalStart,
        seriesZoneOf(master),
        master.start.dateTime ?? master.start.date
      );
      const cutPayload = sanitizeEventPayload({
        ...master,
        recurrence: cutRecurrence,
      });
      const cutConferenceDataVersion = getConferenceDataVersion(cutPayload);
      const cut = yield* Effect.exit(
        Effect.tryPromise({
          // Sent once: a retry's answer would hide that an earlier try,
          // unanswered, may still go through.
          try: () =>
            client.calendars.events.update(
              master.id,
              {
                ...cutPayload,
                calendarId,
                ...(cutConferenceDataVersion
                  ? { conferenceDataVersion: cutConferenceDataVersion }
                  : {}),
              },
              { maxRetries: 0 }
            ),
          catch: (cause) => {
            logGoogleEventUpdateFailure({
              operation: "update",
              calendarId,
              eventId: master.id,
              scope: "following-truncate",
              event: cutPayload,
              cause,
            });
            return new GoogleApiError({ cause });
          },
        })
      );
      if (Exit.isFailure(cut)) {
        // A cut Google never answered (a timeout, a dropped connection) may
        // still go through after it's read back.
        const failure = Cause.findErrorOption(cut.cause);
        const unanswered =
          Option.isSome(failure) &&
          failure.value.cause instanceof APIConnectionError;
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
    return { changes, event: { ...sanitizeEventPayload(master), ...changes } };
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
    opened: Event;
    times: { end: Event["end"]; start: Event["start"] };
  }) =>
    Effect.gen(function* () {
      const { master, times } = params;
      const zone = seriesZoneOf(master);
      const rule = params.edited.recurrence
        ? withSeriesSkips(params.edited.recurrence, master)
        : (master.recurrence ?? []);
      const movesStart = !sameTime(times.start, master.start, zone);
      // Read for what it means: the series' own skips, written again in
      // another form, aren't a new rule.
      const movesSlots =
        movesStart ||
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

      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None").
      const { carried, recurrence } = yield* keptOccurrences({
        calendarId,
        changes,
        edited,
        master,
        opened: currentEvent,
        times,
      });
      const movesStart = !sameTime(times.start, master.start, zone);

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
      const conferenceDataVersion = getConferenceDataVersion(payload);

      const response = yield* Effect.tryPromise({
        try: () =>
          client.calendars.events.update(master.id, {
            ...payload,
            calendarId,
            ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
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
      occurrence
    ).pipe(Effect.asVoid);
  };

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
   * Whether a This and following save from `occurrence` is an Entire
   * series save: it's the whole series (`isWholeSeries`), and either opens
   * it or keeps its times and repeat (still repeating). From an added
   * meeting before the series' start, a new time, date or repeat is that
   * meeting's alone, which the series' own can't take.
   */
  const wholeSeriesEdit = (
    edited: CreateEvent,
    occurrence: Event,
    master: Event,
    zone: string
  ) =>
    isWholeSeries(occurrence, master) &&
    (opensSeries(occurrence, master) ||
      (keepsTimes(edited, occurrence, zone) &&
        repeats(edited.recurrence ?? master.recurrence) &&
        !newRepeat({
          moved: null,
          own: master.recurrence ?? [],
          saved: edited.recurrence,
        })));

  const updateEventFollowing = (
    calendarId: string,
    input: CreateEvent,
    currentEvent: Event
  ) =>
    Effect.gen(function* () {
      // A form toggled to or from all day can send both forms' fields.
      const edited = withOneForm(input, currentEvent);
      const master = yield* getMasterRecurrence(calendarId, currentEvent);
      if (!master.recurrence) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }
      const zone = seriesZoneOf(master);
      if (wholeSeriesEdit(edited, currentEvent, master, zone)) {
        return yield* updateEventAll(calendarId, edited, currentEvent, master);
      }
      const originalStart = originalStartOf(currentEvent, zone);
      if (!originalStart) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
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
        cancelled: exceptions.cancelled,
        edited: edited.recurrence,
        master,
        originalStart,
        start: times.start,
      });
      const carried = placeCarried({
        occurrences: followingOccurrences({
          changes,
          edited,
          // Each is carried, or the save refused if the new part has no
          // place for it ("Repeat: None" has none: one changed later would
          // be lost, as an end set before it would lose it).
          exceptions: exceptions.changed,
          master,
          opened: currentEvent,
          originalStart,
          recurrence,
          start: times.start,
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

      // Keep the occurrence's identity and times when cancelling it.
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

  /**
   * `master`'s rule with its meetings from `originalStart` on deleted. From
   * an added meeting, in a rule whose end can't be worked out, Google's
   * list of the series' meetings says where it ends.
   */
  const deletedFrom = (
    calendarId: string,
    master: Event,
    originalStart: string
  ) =>
    Effect.gen(function* () {
      const zone = seriesZoneOf(master);
      const recurrence = master.recurrence ?? [];
      const seriesStart = master.start.dateTime ?? master.start.date;
      const how = followingDelete({
        masterRecurrence: recurrence,
        masterStart: master.start,
        originalStart,
        seriesZone: zone,
      });
      if (how === "cut") {
        return truncateRecurrenceForFollowing(
          recurrence,
          originalStart,
          zone,
          seriesStart
        );
      }
      if (how === "refuse") {
        return yield* Effect.fail(
          refused({ reason: "deleteFromAddedOccurrence" })
        );
      }
      return deleteFromListed({
        listed: yield* listOccurrenceStarts(calendarId, master),
        originalStart,
        recurrence,
        seriesStart,
        seriesZone: zone,
      });
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

      if (isWholeSeries(instance, master)) {
        return yield* deleteEventAll(calendarId, master.id);
      }

      const originalStartIso = originalStartOf(instance, seriesZoneOf(master));

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      const truncatedRecurrence = yield* deletedFrom(
        calendarId,
        master,
        originalStartIso
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

  /**
   * Moves a series from one of its occurrences on to another calendar: the
   * old series ends before it, and a new one starts there.
   */
  const moveFollowingEvents = Effect.fn("GoogleCalendar.moveFollowingEvents")(
    function* (
      calendarId: string,
      instance: Event,
      destinationCalendarId: string
    ) {
      const master = yield* getMasterRecurrence(calendarId, instance);
      if (!master.recurrence?.length) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event is not a recurring event"),
          })
        );
      }

      if (isWholeSeries(instance, master)) {
        return yield* moveSingleEvent(
          calendarId,
          master.id,
          destinationCalendarId
        );
      }

      const zone = seriesZoneOf(master);
      const originalStart = originalStartOf(instance, zone);
      if (!originalStart) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }
      const blocked = splitBlockedError(master, originalStart);
      if (blocked) {
        return yield* Effect.fail(blocked);
      }

      // The new series starts at this occurrence's original slot with the
      // series' fields and length; it and later changed occurrences keep
      // their changes there.
      const slot = seriesSlotAt(master, originalStart);
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      const recurrence = yield* newSeriesRecurrence({
        cancelled: exceptions.cancelled,
        edited: undefined,
        master,
        originalStart,
        start: slot.start,
      });
      const carried = placeCarried({
        occurrences: [
          {
            at: originalStart,
            changes: changesOwnTo(instance, master, zone),
            originalStart,
          },
          ...exceptions.changed.map((exception) => ({
            at: exception.originalStart,
            changes: changesOwnTo(exception.occurrence, master, zone),
            originalStart: exception.originalStart,
          })),
        ],
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
