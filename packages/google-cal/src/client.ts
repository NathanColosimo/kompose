import { Context, Effect, Exit, Layer, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { GoogleCalendar as GoogleCalendarClient } from "./api-client";
import {
  addsBeforeStart,
  addsSlot,
  carryCount,
  carryCountExactly,
  countOf,
  followingCutUnsure,
  followingSplitBlocked,
  sanitizeEventPayload,
  seriesMeetsAt,
  splitAddedDays,
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
import {
  changedFields,
  keepsTimes,
  ownChanges,
  placeInNewSeries,
  refusalMessage,
  type SeriesRefusal,
  sameTime,
} from "./series-edits";
import { seriesTimesForEdit } from "./series-times";
import {
  DATE_ONLY,
  googleDateTime,
  matchRecurrenceToStart,
  meetsSeveralTimesADay,
  parseDateList,
  type RecurrenceValue,
  readRecurrenceValue,
  startInstant,
  untilMoment,
} from "./until";

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
 * A series' start and end moved to one of its occurrences' original slot
 * (`originalStart`), keeping the series' length and zone.
 */
function seriesSlotAt(
  master: Event,
  originalStart: string
): { end: Event["end"]; start: Event["start"] } {
  if (master.start.date && master.end.date) {
    const days = Math.max(
      1,
      Temporal.PlainDate.from(master.start.date).until(master.end.date).days
    );
    const day = Temporal.PlainDate.from(originalStart.slice(0, 10));
    return {
      end: { date: day.add({ days }).toString() },
      start: { date: day.toString() },
    };
  }
  const zone = seriesZoneOf(master);
  const from = startInstant(master.start, zone);
  const to = startInstant(master.end, zone);
  const length = from && to ? from.until(to) : new Temporal.Duration();
  const start = Temporal.Instant.from(originalStart);
  const written = (moment: Temporal.Instant) =>
    googleDateTime(moment.toZonedDateTimeISO(zone));
  return {
    end: {
      dateTime: written(start.add(length)),
      timeZone: master.end.timeZone ?? master.start.timeZone,
    },
    start: { dateTime: written(start), timeZone: master.start.timeZone },
  };
}

/** The zone a series' days are counted in. */
function seriesZoneOf(master: { start: { timeZone?: string } }): string {
  return master.start.timeZone ?? "UTC";
}

/** Whether `recurrence` repeats at all: a rule, or an added day. */
function repeats(recurrence: string[] | undefined): boolean {
  return (recurrence ?? []).some(
    (line) => line.startsWith("RRULE:") || line.startsWith("RDATE")
  );
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
  const clockOf = (time: Event["start"]) =>
    startInstant(time, zone)?.toZonedDateTimeISO(zone).toPlainTime();
  const from = clockOf(master.start);
  const to = clockOf(start);
  return from && to && Temporal.PlainTime.compare(from, to) !== 0
    ? { from, to }
    : null;
}

/**
 * A skip's key: its moment, or its date for an all-day one.
 */
function skipKey(value: RecurrenceValue): string {
  return value.instant
    ? String(value.instant.epochMilliseconds)
    : value.day.toString();
}

/** The values of `recurrence`'s skip (EXDATE) lines, read in `zone`. */
function skippedValues(recurrence: string[], zone: string): RecurrenceValue[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith("EXDATE") ? parseDateList(line, zone) : null;
    return (list?.values ?? []).flatMap((value) => {
      const read = list && readRecurrenceValue(value, list.zone, zone);
      return read ? [read] : [];
    });
  });
}

/**
 * `recurrence` with the occurrences at `starts` (original starts, as
 * Google writes them) skipped, each once: a skip it already has (read in
 * the series' `zone`) isn't written again. Unchanged when it doesn't
 * repeat.
 */
function skipping(
  recurrence: string[],
  starts: string[],
  zone: string
): string[] {
  if (starts.length === 0 || !repeats(recurrence)) {
    return recurrence;
  }
  const skipped = new Set(skippedValues(recurrence, zone).map(skipKey));
  const fresh = starts.filter((start) => {
    const value = readRecurrenceValue(start, zone, zone);
    return !(value && skipped.has(skipKey(value)));
  });
  if (fresh.length === 0) {
    return recurrence;
  }
  const dates = fresh
    .filter((start) => DATE_ONLY.test(start))
    .map((start) => start.replace(/-/g, ""));
  const times = fresh
    .filter((start) => !DATE_ONLY.test(start))
    .map((start) =>
      Temporal.Instant.from(start)
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "")
    );
  return [
    ...recurrence,
    ...(dates.length > 0 ? [`EXDATE;VALUE=DATE:${dates.join(",")}`] : []),
    ...(times.length > 0 ? [`EXDATE:${times.join(",")}`] : []),
  ];
}

/**
 * `recurrence`'s timed skips (as original starts in `zone`), taken out of
 * it: its EXDATE lines whose every value is a date-time, and the rest.
 */
function takeTimedSkips(
  recurrence: string[],
  zone: string
): { rest: string[]; skips: string[] } {
  const rest: string[] = [];
  const skips: string[] = [];
  for (const line of recurrence) {
    const values = line.startsWith("EXDATE") ? skippedValues([line], zone) : [];
    const moments = values.flatMap((value) =>
      value.instant ? [value.instant] : []
    );
    if (values.length > 0 && moments.length === values.length) {
      skips.push(
        ...moments.map((moment) =>
          googleDateTime(moment.toZonedDateTimeISO(zone))
        )
      );
    } else {
      rest.push(line);
    }
  }
  return { rest, skips };
}

/**
 * `recurrence` with only the skip (EXDATE) values `keep` accepts (as
 * original starts in `zone`), each line otherwise as written; a line left
 * with none goes.
 */
function keepingSkips(
  recurrence: string[],
  zone: string,
  keep: (slot: string) => boolean
): string[] {
  return recurrence.flatMap((line) => {
    const list = line.startsWith("EXDATE") ? parseDateList(line, zone) : null;
    if (!list) {
      return [line];
    }
    const kept = list.values.filter((value) => {
      const read = readRecurrenceValue(value, list.zone, zone);
      const slot = read?.instant
        ? googleDateTime(read.instant.toZonedDateTimeISO(zone))
        : read?.day.toString();
      return !slot || keep(slot);
    });
    if (kept.length === list.values.length) {
      return [line];
    }
    return kept.length > 0
      ? [`${line.slice(0, line.indexOf(":") + 1)}${kept.join(",")}`]
      : [];
  });
}

/**
 * The rule a series is written with once it starts at `start`: `rule`
 * (the one being saved) lined up with that start, with the occurrences
 * deleted on their own (`cancelled`) skipped.
 *
 * When a series that meets once a day moves to another time of day,
 * every skip, those `rule` already has as well as `cancelled`, is placed
 * once, as the meetings move, whatever times the rule sends (BYHOUR=10
 * with a 10:00 start reads as a time of its own against the old start):
 * - a rule's (or the start's) meeting moves to the new time on its day,
 *   so its skip goes there, added after the rule is lined up, and never
 *   onto an added (RDATE) meeting the saved series still has on;
 * - an added meeting keeps its time, so its skip is lined up with the
 *   rule like any other, and is placed at the new time too only if a
 *   rule or the start met there as well.
 * Otherwise the skips are lined up with the rule as it is.
 */
function lineUpRule(params: {
  cancelled: string[];
  master: Event;
  rule: string[];
  /** A split's original start (see `ruleForStart`). */
  splitAt?: string;
  start: Event["start"];
}): string[] {
  const { master, splitAt, start } = params;
  const zone = seriesZoneOf(master);
  const before = master.recurrence ?? [];
  const rules = before.filter((line) => line.startsWith("RRULE:"));
  // Whether a rule (or the start) met at `slot`; a rule whose days can't
  // be read may have: a skip where nothing meets does nothing.
  const ruleMetAt = (slot: string) =>
    seriesMeetsAt({
      recurrence: rules,
      seriesZone: zone,
      slot,
      start: master.start,
    }) !== false;
  // A deleted added (RDATE) meeting the save removes has nothing left to
  // skip, unless a rule (the old series' or the saved one's) or the start
  // meets there: kept, its timed skip would be lined up onto that day's
  // other meeting.
  const savedRules = params.rule.filter((line) => line.startsWith("RRULE:"));
  const stillMeets = (slot: string) =>
    // A date skips the whole day, whatever meets on it.
    DATE_ONLY.test(slot) ||
    !addsSlot(before, slot, zone) ||
    addsSlot(params.rule, slot, zone) ||
    ruleMetAt(slot) ||
    seriesMeetsAt({
      recurrence: savedRules,
      seriesZone: zone,
      slot,
      start: master.start,
    }) !== false;
  const cancelled = params.cancelled.filter(stillMeets);
  const rule = keepingSkips(params.rule, zone, stillMeets);
  const change = timeOfDayChange(master, start);
  if (!change || meetsSeveralTimesADay(before, change.from)) {
    return (
      ruleForStart(skipping(rule, cancelled, zone), master, start, splitAt) ??
      []
    );
  }
  // The rule's own timed skips are placed with the deleted occurrences.
  const { rest, skips } = takeTimedSkips(rule, zone);
  const deleted = [...cancelled, ...skips];
  const atNewTime: string[] = [];
  const withRule: string[] = [];
  for (const slot of deleted) {
    const moment = DATE_ONLY.test(slot) ? null : slotMoment(slot, zone);
    if (!moment) {
      withRule.push(slot);
      continue;
    }
    const added = addsSlot(before, slot, zone);
    if (added) {
      withRule.push(slot);
    }
    const ruleMet = !added || ruleMetAt(slot);
    if (ruleMet) {
      atNewTime.push(
        googleDateTime(
          moment
            .toZonedDateTimeISO(zone)
            .toPlainDate()
            .toZonedDateTime({ plainTime: change.to, timeZone: zone })
        )
      );
    }
  }
  const lined =
    ruleForStart(skipping(rest, withRule, zone), master, start, splitAt) ?? [];
  const deletedKeys = new Set(
    deleted.flatMap((slot) => {
      const value = readRecurrenceValue(slot, zone, zone);
      return value ? [skipKey(value)] : [];
    })
  );
  // An added meeting the saved series has, unless it was deleted too.
  const onAddedMeeting = (at: string) => {
    const value = readRecurrenceValue(at, zone, zone);
    return (
      addsSlot(lined, at, zone) && !(value && deletedKeys.has(skipKey(value)))
    );
  };
  return skipping(
    lined,
    atNewTime.filter((at) => !onAddedMeeting(at)),
    zone
  );
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

const RULE_UNTIL = /[:;]UNTIL=([^;]+)/;

/**
 * A start's moment: its date-time (one without an offset read in its own
 * time zone, or `zone`, as Google does), or the start of its date in
 * `zone`; null when it doesn't parse.
 */
function firstMoment(
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): Temporal.Instant | null {
  if (start.dateTime) {
    return startInstant(start, zone);
  }
  try {
    return start.date
      ? Temporal.PlainDate.from(start.date)
          .toZonedDateTime({ timeZone: zone })
          .toInstant()
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether an edit through `occurrence` is to its series' first meeting:
 * the master itself, or the occurrence at its start (an added meeting
 * before it isn't: the series doesn't start there).
 */
function opensSeries(occurrence: Event, master: Event): boolean {
  if (!occurrence.recurringEventId) {
    return true;
  }
  const zone = seriesZoneOf(master);
  const original = firstMoment(
    occurrence.originalStartTime ?? occurrence.start,
    zone
  );
  const first = firstMoment(master.start, zone);
  return Boolean(
    original && first && Temporal.Instant.compare(original, first) === 0
  );
}

/**
 * Whether a new series' rule ends (UNTIL) before its own first meeting:
 * Google would keep only that meeting.
 */
function endsBeforeStart(
  recurrence: string[],
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): boolean {
  const until = recurrence
    .find((line) => line.startsWith("RRULE:"))
    ?.match(RULE_UNTIL)?.[1];
  const last = until ? untilMoment(until, zone) : null;
  const first = firstMoment(start, zone);
  return Boolean(last && first && Temporal.Instant.compare(last, first) < 0);
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
 * A series' rule as written with its `start`: UNTIL and EXDATE/RDATE in
 * the start's form, skipped occurrences at its time, all counted on the
 * series' days in its zone. Applied to whatever the series ends up with,
 * the client's rule or its kept one, so a rule a client lined up with an
 * occurrence (rescheduled to 11:00, say) can't skip the wrong times.
 */
function ruleForStart(
  rule: string[] | undefined,
  master: { start: { date?: string; dateTime?: string; timeZone?: string } },
  start: { date?: string; dateTime?: string; timeZone?: string },
  /**
   * A split's original start: the new series' first meeting before the
   * edit. Its times are read from there (the old series' start isn't in
   * the new one), and its COUNT counts from its time when it's made all
   * day.
   */
  splitAt?: string
): string[] | undefined {
  const zone = repeatZone(master, start);
  const splitClock =
    splitAt && !DATE_ONLY.test(splitAt)
      ? Temporal.Instant.from(splitAt).toZonedDateTimeISO(zone).toPlainTime()
      : null;
  const days =
    start.date && splitClock
      ? { firstDay: Temporal.PlainDate.from(start.date), firstTime: splitClock }
      : undefined;
  const from = splitClock && splitAt ? { dateTime: splitAt } : master.start;
  return rule && matchRecurrenceToStart(rule, start, zone, from, days);
}

/**
 * `time` in the series' zone when it has one, the same moment: a
 * date-time without an offset is read in its own zone (as Google does)
 * and written with the series' offset, so relabelling it can't move it.
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

/**
 * A start as a series' slot: a date, or a date-time with the series'
 * offset (one Google wrote without an offset read in its own zone). Null
 * when it has neither.
 */
function slotOf(
  start: { date?: string; dateTime?: string; timeZone?: string },
  zone: string
): string | null {
  if (start.date) {
    return start.date;
  }
  const moment = startInstant(start, zone);
  return moment ? googleDateTime(moment.toZonedDateTimeISO(zone)) : null;
}

/** An occurrence's original start: the slot it holds in its series. */
function originalStartOf(occurrence: Event, zone: string): string | null {
  return slotOf(occurrence.originalStartTime ?? occurrence.start, zone);
}

/**
 * A series' times after an "Entire series" edit made through
 * `occurrence`. Times left as the occurrence had them leave the series'
 * alone (an occurrence moved on its own doesn't move it). An edit to the
 * series' first meeting moves its date; through any other occurrence the
 * series keeps its first date (a date move there is "This and following"
 * only). Google repeats a series in its start's zone, so the edit's times
 * are read in the series' zone (the same moments).
 */
function entireSeriesTimes(
  edited: CreateEvent,
  occurrence: Event,
  master: Event
): { end: Event["end"]; start: Event["start"] } {
  const kept = { end: master.end, start: master.start };
  if (keepsTimes(edited, occurrence, seriesZoneOf(master))) {
    return kept;
  }
  const end = inSeriesZone(edited.end, master.end);
  const start = inSeriesZone(edited.start, master.start);
  if (opensSeries(occurrence, master)) {
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
 * An Entire series edit's times for the occurrence it was made through,
 * as the series takes them (`seriesTimesForEdit`) but on the occurrence's
 * own day, since the series keeps its dates: the edit's form, time of day
 * and length (or span of days). Its own times when they don't parse.
 */
function timesOnOwnDay(
  occurrence: Event,
  edited: CreateEvent,
  master: Event
): { end: Event["end"]; start: Event["start"] } {
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
 * Whether `start` moves the time of day of a series that meets several
 * times a day. It has a rule per time, so its start's time can't move
 * without moving one of them onto another's, or off its own.
 */
function movesSeveralADay(master: Event, start: Event["start"]): boolean {
  const change = timeOfDayChange(master, start);
  return Boolean(
    change && meetsSeveralTimesADay(master.recurrence ?? [], change.from)
  );
}

/** A slot's moment (a date's start, in `zone`); null if it doesn't parse. */
function slotMoment(slot: string, zone: string): Temporal.Instant | null {
  return firstMoment(
    DATE_ONLY.test(slot) ? { date: slot } : { dateTime: slot },
    zone
  );
}

/**
 * `master`'s exceptions among `events` (it and its exceptions, as Google
 * lists them), all or those after `after` (an original start): the
 * original starts of those cancelled, and those moved or edited.
 */
function sortExceptions(
  events: SeriesListing[],
  master: Event,
  after: string | null
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
    } else if (Object.keys(changesOwnTo(event, master, {}, zone)).length > 0) {
      // An occurrence just as the series has it (moved and moved back)
      // has nothing to keep.
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
  edited: Partial<CreateEvent>,
  zone: string
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
 * The occurrences a "This and following" edit's new series carries, and
 * where: the opened one at its start, keeping what's its own (its times
 * only when the edit left them, since changed times start the new
 * series), and later ones changed on their own at their places in it.
 */
function followingOccurrences(params: {
  /** The fields the edit changed, which the new series carries. */
  changes: Partial<CreateEvent>;
  exceptions: { occurrence: Event; originalStart: string }[];
  /** Whether the edit left the opened occurrence's times. */
  keptTimes: boolean;
  master: Event;
  opened: Event;
  originalStart: string;
  /** The new series' start. */
  start: Event["start"];
}) {
  const { changes, master, originalStart, start } = params;
  const zone = seriesZoneOf(master);
  const own = changesOwnTo(params.opened, master, changes, zone);
  const { end: _end, start: _start, ...ownFields } = own;
  return [
    {
      at: slotOf(start, zone),
      changes: params.keptTimes ? own : ownFields,
      originalStart,
    },
    ...params.exceptions.map((exception) => ({
      // An added (RDATE) meeting keeps its own slot in the new series, as
      // its RDATE does; a rule meeting moves as the series did.
      at: addsSlot(master.recurrence ?? [], exception.originalStart, zone)
        ? sameForm(exception.originalStart, start)
        : placeInNewSeries({
            newStart: start,
            originalStart: exception.originalStart,
            splitStart: originalStart,
            zone,
          }),
      changes: changesOwnTo(exception.occurrence, master, changes, zone),
      originalStart: exception.originalStart,
    })),
  ];
}

/** `slot` when it has `start`'s form (a date, or a date-time); else null. */
function sameForm(slot: string, start: Event["start"]): string | null {
  return DATE_ONLY.test(slot) === Boolean(start.date) ? slot : null;
}

/**
 * The occurrences a new series has to carry, each with changes of its
 * own, checked against it: Google keeps an occurrence's changes only at a
 * slot its series meets at. A refusal names, by original start, those
 * the new series has no meeting for, so nothing is written then.
 */
function placeCarried(params: {
  occurrences: {
    at: string | null;
    changes: Partial<CreateEvent>;
    originalStart: string;
  }[];
  recurrence: string[];
  start: Event["start"];
  zone: string;
}): CarriedOccurrence[] | SeriesRefusal {
  const carried: CarriedOccurrence[] = [];
  const lost = new Set<string>();
  // Each slot holds one occurrence: two that land on one can't both keep
  // their changes.
  const placed = new Map<number, string>();
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
    const moment = at && meets === true ? slotMoment(at, params.zone) : null;
    const taken = moment && placed.get(moment.epochMilliseconds);
    if (!(at && moment) || taken) {
      lost.add(taken || originalStart).add(originalStart);
      continue;
    }
    placed.set(moment.epochMilliseconds, originalStart);
    carried.push({ at, changes });
  }
  return lost.size > 0
    ? { originalStarts: [...lost], reason: "dropsChangedOccurrences" }
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

const SeriesRefusalSchema = Schema.Union([
  Schema.Struct({
    reason: Schema.Literals([
      "severalRules",
      "addedOccurrence",
      "deleteFromAddedOccurrence",
      "addedBeforeStart",
      "endsBeforeStart",
      "countUnknown",
      "severalTimesADay",
    ]),
  }),
  Schema.Struct({
    originalStarts: Schema.Array(Schema.String),
    reason: Schema.Literal("dropsChangedOccurrences"),
  }),
]);

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
   * The original starts of all a COUNT series' occurrences (it's finite),
   * cancelled ones too, as Google lists them: one rescheduled past the
   * split still has its place.
   */
  const listOccurrenceStarts = (calendarId: string, masterId: string) =>
    Effect.gen(function* () {
      const starts: string[] = [];
      let pageToken: string | undefined;
      do {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.instances(masterId, {
              calendarId,
              maxResults: 2500,
              pageToken,
              showDeleted: true,
            }),
          catch: (cause) => new GoogleApiError({ cause }),
        });
        for (const item of response.items ?? []) {
          const start = item.originalStartTime ?? item.start;
          const value = start?.dateTime ?? start?.date;
          if (value) {
            starts.push(value);
          }
        }
        pageToken = response.nextPageToken ?? undefined;
      } while (pageToken);
      return starts;
    });

  /**
   * `master`'s occurrences changed one at a time, which Google keeps as
   * exceptions (not in the rule), all of them or those after `after` (an
   * original start): the original starts of those cancelled, and those
   * moved or edited. Listed by the series' iCalUID (its master and
   * exceptions only, so a series that never ends isn't expanded).
   */
  const exceptionsOf = (
    calendarId: string,
    master: Event,
    after: string | null
  ) =>
    Effect.gen(function* () {
      const iCalUID = master.iCalUID;
      if (!iCalUID) {
        // Google gives every event one; without it the series' moved
        // occurrences can't be checked, so nothing is written.
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
   * The rule a series' new part repeats with, from `originalStart` on: the
   * edit's own (`edited`), or the series' kept rule. Either way:
   * - a COUNT the user didn't change carries on (a five-time series moved
   *   to another day at its third runs three more, not five);
   * - occurrences `cancelled` after the split stay skipped, on their own
   *   days (moved or edited ones are placed by the day move instead, as
   *   they must land on a meeting to be kept): a shifted deletion would
   *   skip a meeting on a day the user never deleted;
   * - it's lined up with the new part's `start`.
   * Fails with a refusal, before anything is written, when its COUNT
   * can't be carried or it would end before that start.
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
      const { calendarId, master, originalStart, start } = params;
      // The new part repeats from the split on: added days before it stay
      // with the old part.
      const fromSplit = splitAddedDays(
        params.edited ?? master.recurrence ?? [],
        originalStart,
        seriesZoneOf(master),
        "from"
      );
      const counted = yield* carriedCount(
        calendarId,
        master,
        fromSplit,
        originalStart
      );
      if (!counted) {
        return yield* Effect.fail(refused({ reason: "countUnknown" }));
      }
      const recurrence = lineUpRule({
        cancelled: params.cancelled,
        master,
        rule: counted,
        splitAt: originalStart,
        start,
      });
      if (endsBeforeStart(recurrence, start, repeatZone(master, start))) {
        return yield* Effect.fail(refused({ reason: "endsBeforeStart" }));
      }
      return recurrence;
    });

  /**
   * `rule` (a split's new part) with the COUNT the user kept carried on:
   * the series' positions left after `originalStart`; unchanged when the
   * COUNT was changed or there is none. Null when what's left can't be
   * known.
   */
  const carriedCount = (
    calendarId: string,
    master: Event,
    rule: string[],
    originalStart: string
  ) =>
    Effect.gen(function* () {
      const count = countOf(master.recurrence);
      if (count === undefined || countOf(rule) !== count) {
        return rule;
      }
      const counting = {
        masterRecurrence: master.recurrence ?? [],
        originalStart,
        seriesStart:
          master.start.dateTime ?? master.start.date ?? originalStart,
        seriesZone: seriesZoneOf(master),
      };
      // A rule that can be read is counted without asking Google.
      const exact = carryCountExactly(rule, counting);
      if (exact) {
        return exact;
      }
      const starts = yield* listOccurrenceStarts(calendarId, master.id);
      return carryCount(rule, { ...counting, starts });
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
      // As a single occurrence's update is written (see
      // buildThisOccurrenceUpdatePayload): it keeps its place in the series.
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
   * Splits `master` at `originalStart` into `newSeries` (in
   * `destinationCalendarId`), whole or not at all. The new series is
   * created first, under an id chosen here, with the `carried`
   * occurrences put back on it; only then is the old series cut to end
   * before the split (which makes Google drop its occurrences after it).
   * A failure before the cut deletes the new series, so the old one is as
   * it was. A failed cut is checked by reading the series back: its rule
   * unchanged, the new one is deleted; changed, the split stands;
   * unknown, both are left (an occurrence shown twice beats one lost) and
   * the failure kept.
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
      const discardNew = Effect.tryPromise({
        try: () =>
          client.calendars.events.delete(seriesId, {
            calendarId: destinationCalendarId,
          }),
        catch: (cause) => new GoogleApiError({ cause }),
      }).pipe(Effect.ignore);

      // A new part that doesn't repeat ("Repeat: None") is one event with
      // no occurrences: the one carried (at its start) goes on it.
      const repeating = repeats(newSeries.recurrence);
      const written = repeating
        ? newSeries
        : Object.assign(
            {},
            newSeries,
            ...params.carried.map((carried) => carried.changes)
          );
      const conferenceDataVersion = getConferenceDataVersion(written);
      const created = yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            client.calendars.events.create(destinationCalendarId, {
              ...written,
              id: seriesId,
              ...(conferenceDataVersion ? { conferenceDataVersion } : {}),
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
        });
        const series = yield* parseEventResponse(response);
        for (const carried of repeating ? params.carried : []) {
          yield* putBack(destinationCalendarId, seriesId, carried);
        }
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
          try: () =>
            client.calendars.events.update(master.id, {
              ...cutPayload,
              calendarId,
              ...(cutConferenceDataVersion
                ? { conferenceDataVersion: cutConferenceDataVersion }
                : {}),
            }),
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
        const current = yield* Effect.exit(getEvent(calendarId, master.id));
        if (Exit.isFailure(current)) {
          return yield* Effect.failCause(cut.cause);
        }
        if (
          JSON.stringify(current.value.recurrence) ===
          JSON.stringify(master.recurrence)
        ) {
          yield* discardNew;
          return yield* Effect.failCause(cut.cause);
        }
      }
      return created;
    });

  /**
   * An edit made through `occurrence` as it applies to its series: the
   * series' own fields, with those the user changed (the edit differs
   * from the occurrence it was made from) taken from the edit, so an
   * occurrence's own title or notes aren't written onto every meeting.
   */
  const asSeriesEdit = (
    edited: CreateEvent,
    occurrence: Event,
    master: Event
  ) => {
    const changes = changedFields(edited, occurrence);
    return { changes, event: { ...sanitizeEventPayload(master), ...changes } };
  };

  const updateEventAll = (
    calendarId: string,
    edited: CreateEvent,
    currentEvent: Event,
    master: Event
  ) =>
    Effect.gen(function* () {
      const zone = seriesZoneOf(master);
      const { changes, event } = asSeriesEdit(edited, currentEvent, master);
      const times = entireSeriesTimes(edited, currentEvent, master);
      if (movesSeveralADay(master, times.start)) {
        return yield* Effect.fail(refused({ reason: "severalTimesADay" }));
      }

      // Left out keeps the series' pattern; an empty list ends it
      // ("Repeat: None"). Either way in the form the series' start takes.
      const rule = edited.recurrence ?? master.recurrence ?? [];
      let recurrence = ruleForStart(rule, master, times.start) ?? [];
      const movesSlots =
        !sameTime(times.start, master.start, zone) ||
        JSON.stringify(recurrence) !== JSON.stringify(master.recurrence ?? []);
      if (movesSlots) {
        // Google ties an occurrence changed on its own to its original
        // slot: one deleted stays deleted only as a skip at the series'
        // new slots, and one moved or edited would be dropped (refused).
        const { cancelled, changed } = yield* exceptionsOf(
          calendarId,
          master,
          null
        );
        recurrence = lineUpRule({
          cancelled,
          master,
          rule,
          start: times.start,
        });
        const lost = changed
          .map(({ originalStart }) => originalStart)
          .filter(
            (slot) =>
              seriesMeetsAt({
                recurrence,
                seriesZone: repeatZone(master, times.start),
                slot,
                start: times.start,
              }) !== true
          );
        if (lost.length > 0) {
          return yield* Effect.fail(
            refused({ originalStarts: lost, reason: "dropsChangedOccurrences" })
          );
        }
      }

      const payload: CreateEvent = {
        ...event,
        end: times.end,
        recurrence,
        start: times.start,
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
      yield* applyToOpened({
        calendarId,
        changes,
        edited,
        master,
        occurrence: currentEvent,
      });
      return updated;
    });

  /**
   * Google keeps an occurrence's own values when its series changes, so
   * what the user changed through an occurrence that set its own (one
   * moved and renamed, say) is written to that occurrence too: a field
   * it set itself, or its times (then the edit's, else its own move
   * stays).
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
    const own = changesOwnTo(occurrence, master, {}, zone);
    // The edit's time of day and length, on the occurrence's own day: the
    // series keeps its dates, and so does it.
    const times = timesOnOwnDay(occurrence, edited, master);
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
   * "This and following" from a series' first meeting is the whole series
   * (a cut before its start would leave that meeting), unless meetings
   * were added before it: those aren't "following", so it's refused.
   */
  const wholeSeriesFromStart = <A, E>(
    master: Event,
    whole: Effect.Effect<A, E>
  ): Effect.Effect<A, E | GoogleApiError> =>
    addsBeforeStart(master.recurrence ?? [], master.start, seriesZoneOf(master))
      ? Effect.fail(refused({ reason: "addedBeforeStart" }))
      : whole;

  const updateEventFollowing = (
    calendarId: string,
    edited: CreateEvent,
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
      if (opensSeries(currentEvent, master)) {
        return yield* wholeSeriesFromStart(
          master,
          updateEventAll(calendarId, edited, currentEvent, master)
        );
      }
      const zone = seriesZoneOf(master);
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
      // Times left as the occurrence had them: the new series starts at
      // its original slot, at the series' time and length (it keeps its
      // own move as an exception). Otherwise at the edit's, read once in
      // the series' zone (Google repeats a series in its start's zone).
      const keptTimes = keepsTimes(edited, currentEvent, zone);
      const times = keptTimes
        ? seriesSlotAt(master, originalStart)
        : {
            end: inSeriesZone(edited.end, master.end),
            start: inSeriesZone(edited.start, master.start),
          };
      const exceptions = yield* exceptionsOf(calendarId, master, originalStart);
      // Left out keeps the series' pattern (its UNTIL in the form the new
      // start takes); an empty list ends it ("Repeat: None").
      const recurrence = yield* newSeriesRecurrence({
        calendarId,
        cancelled: exceptions.cancelled,
        edited: edited.recurrence,
        master,
        originalStart,
        start: times.start,
      });
      const carried = placeCarried({
        occurrences: followingOccurrences({
          changes,
          exceptions: exceptions.changed,
          keptTimes,
          master,
          opened: currentEvent,
          originalStart,
          start: times.start,
        }),
        recurrence,
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

      if (opensSeries(instance, master)) {
        return yield* wholeSeriesFromStart(
          master,
          deleteEventAll(calendarId, master.id)
        );
      }

      const originalStartIso = originalStartOf(instance, seriesZoneOf(master));

      if (!originalStartIso) {
        return yield* Effect.fail(
          new GoogleApiError({
            cause: new Error("Event start is not a date or dateTime"),
          })
        );
      }

      // From an added meeting, in a rule whose end can't be told, a cut
      // might reach past where it really ended: refused, not guessed.
      if (
        followingCutUnsure({
          masterRecurrence: master.recurrence,
          masterStart: master.start,
          originalStart: originalStartIso,
          seriesZone: seriesZoneOf(master),
        })
      ) {
        return yield* Effect.fail(
          refused({ reason: "deleteFromAddedOccurrence" })
        );
      }

      const truncatedRecurrence = truncateRecurrenceForFollowing(
        master.recurrence,
        originalStartIso,
        seriesZoneOf(master),
        master.start.dateTime ?? master.start.date
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

      if (opensSeries(instance, master)) {
        return yield* wholeSeriesFromStart(
          master,
          moveSingleEvent(calendarId, master.id, destinationCalendarId)
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

      // The new series is the series from this occurrence's place on:
      // its original slot, with the series' own fields and length, and
      // the rest of a COUNT; its rule lined up with that start. The
      // occurrence itself and later ones changed on their own keep their
      // changes there.
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
          {
            at: originalStart,
            changes: changesOwnTo(instance, master, {}, zone),
            originalStart,
          },
          ...exceptions.changed.map((exception) => ({
            at: exception.originalStart,
            changes: changesOwnTo(exception.occurrence, master, {}, zone),
            originalStart: exception.originalStart,
          })),
        ],
        recurrence,
        start: slot.start,
        zone,
      });
      if (!Array.isArray(carried)) {
        return yield* Effect.fail(refused(carried));
      }
      const created = yield* splitSeries({
        calendarId,
        carried,
        destinationCalendarId,
        master,
        newSeries: sanitizeEventPayload({ ...master, ...slot, recurrence }),
        originalStart,
      });

      return created;
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
