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

/** The local day `time` falls on, in `timeZone`. */
function dayIn(time: EventTime, timeZone: string): Temporal.PlainDate | null {
  if (time.date) {
    return Temporal.PlainDate.from(time.date);
  }
  return time.dateTime
    ? Temporal.Instant.from(time.dateTime).toZonedDateTimeISO(timeZone).toPlainDate()
    : null;
}

function lengthMs(start: EventTime, end: EventTime): number | null {
  if (!(start.dateTime && end.dateTime)) {
    return null;
  }
  return (
    Temporal.Instant.from(end.dateTime).epochMilliseconds -
    Temporal.Instant.from(start.dateTime).epochMilliseconds
  );
}

/** "2026-10-06T09:00:00-04:00": a zoned time as Google takes it. */
function googleDateTime(time: Temporal.ZonedDateTime): string {
  return time.toString({ timeZoneName: "never", smallestUnit: "second" });
}

/**
 * The series keeps its own first day and takes the edit's form, times and
 * length: an occurrence made all day makes the series all day (and back),
 * and a timed edit's wall-clock time applies in the event's time zone, so a
 * series begun before a daylight-saving change keeps its 9:00 (pasting the
 * edit's UTC time onto that day would move it an hour).
 */
export function seriesTimesForEdit(params: {
  editedEnd: EventTime;
  editedStart: EventTime;
  masterEnd: EventTime;
  masterStart: EventTime;
}): { end: EventTime; start: EventTime } | null {
  const { editedEnd, editedStart, masterEnd, masterStart } = params;
  const timeZone = editedStart.timeZone ?? masterStart.timeZone;
  if (!timeZone) {
    return null;
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
  if (!editedStart.dateTime) {
    return null;
  }
  const wallClock = Temporal.Instant.from(editedStart.dateTime)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime();
  const start = day.toZonedDateTime({ plainTime: wallClock, timeZone });
  const length =
    lengthMs(editedStart, editedEnd) ?? lengthMs(masterStart, masterEnd) ?? 0;
  return {
    end: {
      dateTime: googleDateTime(start.add({ milliseconds: length })),
      timeZone,
    },
    start: { dateTime: googleDateTime(start), timeZone },
  };
}
