/**
 * Where a series starts and ends after an "Entire series" edit made through
 * one of its occurrences.
 */
import { Temporal } from "temporal-polyfill";

export interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

const OFFSET = /([+-]\d{2}:\d{2}|Z)$/;

/**
 * The moment a Google dateTime names. Google also takes one without an
 * offset when a time zone comes with it, read in that zone; null for one
 * that doesn't parse.
 */
function instantOf(
  dateTime: string,
  timeZone: string
): Temporal.Instant | null {
  try {
    return OFFSET.test(dateTime)
      ? Temporal.Instant.from(dateTime)
      : Temporal.PlainDateTime.from(dateTime)
          .toZonedDateTime(timeZone)
          .toInstant();
  } catch {
    return null;
  }
}

/**
 * The zone to read and write times in: the series' (Google repeats a
 * series in its start's zone, so a Tokyo meeting edited from New York
 * stays on Tokyo's days), the edit's, or, when neither says, the fixed
 * offset the edit was written with.
 */
function zoneOf(edited: EventTime, master: EventTime): string {
  const offset = edited.dateTime ? OFFSET.exec(edited.dateTime)?.[1] : null;
  return (
    master.timeZone ??
    edited.timeZone ??
    (offset && offset !== "Z" ? offset : "UTC")
  );
}

/** The local day `time` falls on, in `timeZone`. */
function dayIn(time: EventTime, timeZone: string): Temporal.PlainDate | null {
  if (time.date) {
    return Temporal.PlainDate.from(time.date);
  }
  const instant = time.dateTime ? instantOf(time.dateTime, timeZone) : null;
  return instant ? instant.toZonedDateTimeISO(timeZone).toPlainDate() : null;
}

function lengthMs(
  start: EventTime,
  end: EventTime,
  timeZone: string
): number | null {
  const from = start.dateTime ? instantOf(start.dateTime, timeZone) : null;
  const to = end.dateTime ? instantOf(end.dateTime, timeZone) : null;
  return from && to ? to.epochMilliseconds - from.epochMilliseconds : null;
}

/** "2026-10-06T09:00:00-04:00": a zoned time as Google takes it. */
function googleDateTime(time: Temporal.ZonedDateTime): string {
  return time.toString({ smallestUnit: "second", timeZoneName: "never" });
}

/** Whether two Google times are the same moment (or the same date). */
function sameTime(a: EventTime, b: EventTime, timeZone: string): boolean {
  if (a.date || b.date) {
    return a.date === b.date;
  }
  const from = a.dateTime ? instantOf(a.dateTime, timeZone) : null;
  const to = b.dateTime ? instantOf(b.dateTime, timeZone) : null;
  return Boolean(from && to && Temporal.Instant.compare(from, to) === 0);
}

/**
 * The series keeps its own first day and takes the edit's form, times and
 * length: an occurrence made all day makes the series all day (and back),
 * and a timed edit's wall-clock time applies in the event's time zone, so a
 * series begun before a daylight-saving change keeps its 9:00 (pasting the
 * edit's UTC time onto that day would move it an hour). An edit that left
 * the occurrence's times alone leaves the series' alone, so renaming an
 * occurrence rescheduled before doesn't move the series to its slot. Null
 * only for times that don't parse; the series then keeps its own.
 */
export function seriesTimesForEdit(params: {
  editedEnd: EventTime;
  editedStart: EventTime;
  masterEnd: EventTime;
  masterStart: EventTime;
  /** The occurrence's times before the edit. */
  occurrenceEnd: EventTime;
  occurrenceStart: EventTime;
}): { end: EventTime; start: EventTime } | null {
  const { editedEnd, editedStart, masterEnd, masterStart } = params;
  const timeZone = zoneOf(editedStart, masterStart);
  if (
    sameTime(editedStart, params.occurrenceStart, timeZone) &&
    sameTime(editedEnd, params.occurrenceEnd, timeZone)
  ) {
    return { end: masterEnd, start: masterStart };
  }
  const day = dayIn(masterStart, timeZone);
  if (!day) {
    return null;
  }
  if (editedStart.date) {
    const editedDay = Temporal.PlainDate.from(editedStart.date);
    const editedEndDay = editedEnd.date
      ? Temporal.PlainDate.from(editedEnd.date)
      : editedDay.add({ days: 1 });
    const days = Math.max(1, editedDay.until(editedEndDay).days);
    return {
      end: { date: day.add({ days }).toString() },
      start: { date: day.toString() },
    };
  }
  const editedInstant = editedStart.dateTime
    ? instantOf(editedStart.dateTime, timeZone)
    : null;
  if (!editedInstant) {
    return null;
  }
  const wallClock = editedInstant.toZonedDateTimeISO(timeZone).toPlainTime();
  const start = day.toZonedDateTime({ plainTime: wallClock, timeZone });
  const length =
    lengthMs(editedStart, editedEnd, timeZone) ??
    lengthMs(masterStart, masterEnd, timeZone) ??
    0;
  // A fixed offset reads times but isn't a zone Google takes back.
  const named = masterStart.timeZone ?? editedStart.timeZone;
  const zone = named ? { timeZone: named } : {};
  return {
    end: {
      dateTime: googleDateTime(start.add({ milliseconds: length })),
      ...zone,
    },
    start: { dateTime: googleDateTime(start), ...zone },
  };
}
