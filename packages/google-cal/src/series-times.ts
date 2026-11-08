/**
 * Where a series starts and ends after an "Entire series" edit made through
 * one of its occurrences.
 */
import { Temporal } from "temporal-polyfill";
import { OFFSET, startInstant } from "./until";

export interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
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
  const instant = startInstant(time, timeZone);
  return instant ? instant.toZonedDateTimeISO(timeZone).toPlainDate() : null;
}

function lengthMs(
  start: EventTime,
  end: EventTime,
  timeZone: string
): number | null {
  const from = startInstant(start, timeZone);
  const to = startInstant(end, timeZone);
  return from && to ? to.epochMilliseconds - from.epochMilliseconds : null;
}

/** "2026-10-06T09:00:00-04:00": a zoned time as Google takes it. */
function googleDateTime(time: Temporal.ZonedDateTime): string {
  return time.toString({ smallestUnit: "second", timeZoneName: "never" });
}

/**
 * The series keeps its own first day and takes the edit's form, times and
 * length: an occurrence made all day makes the series all day (and back),
 * and a timed edit's wall-clock time applies in the event's time zone, so a
 * series begun before a daylight-saving change keeps its 9:00 (pasting the
 * edit's UTC time onto that day would move it an hour). For an edit that
 * changed the occurrence's times (one that didn't leaves the series'
 * alone). Null only for times that don't parse; the series then keeps its
 * own.
 */
export function seriesTimesForEdit(params: {
  editedEnd: EventTime;
  editedStart: EventTime;
  masterEnd: EventTime;
  masterStart: EventTime;
}): { end: EventTime; start: EventTime } | null {
  const { editedEnd, editedStart, masterEnd, masterStart } = params;
  const timeZone = zoneOf(editedStart, masterStart);
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
  // Read in its own zone, then projected onto the series' first day in
  // the series' zone.
  const editedInstant = startInstant(editedStart, timeZone);
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
