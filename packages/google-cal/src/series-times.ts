/**
 * A series' zone and slots (where an occurrence sits in it), and where a
 * series starts and ends after an "Entire series" edit made through one of
 * its occurrences.
 */
import { Temporal } from "temporal-polyfill";
import {
  dayOfStart,
  googleDateTime,
  lengthMs,
  OFFSET,
  startInstant,
} from "./until";

interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The zone a series' days are counted in. */
export function seriesZoneOf(master: { start: { timeZone?: string } }): string {
  return master.start.timeZone ?? "UTC";
}

/**
 * A start as a series' slot: its date, or its moment written with the
 * series' offset. Null when it has neither.
 */
export function slotOf(start: EventTime, zone: string): string | null {
  if (start.date) {
    return start.date;
  }
  const moment = startInstant(start, zone);
  return moment ? googleDateTime(moment.toZonedDateTimeISO(zone)) : null;
}

/**
 * A series' start and end moved to one of its occurrences' original slot
 * (`originalStart`), keeping the series' length and zone.
 */
export function seriesSlotAt(
  master: { end: EventTime; start: EventTime },
  originalStart: string
): { end: EventTime; start: EventTime } {
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

/**
 * The zone to read and write times in: the series' (Google repeats a
 * series in its start's zone, so a Tokyo meeting edited from New York
 * keeps Tokyo's days), else the edit's, else the edit's fixed offset.
 */
function zoneOf(edited: EventTime, master: EventTime): string {
  const offset = edited.dateTime ? OFFSET.exec(edited.dateTime)?.[1] : null;
  return (
    master.timeZone ??
    edited.timeZone ??
    (offset && offset !== "Z" ? offset : "UTC")
  );
}

/**
 * The series' times after an edit changed an occurrence's: its own first
 * day, with the edit's form (timed or all day), wall-clock time and
 * length, so a series begun before a DST change keeps its 9:00. Null when
 * the times don't parse; the series then keeps its own.
 */
export function seriesTimesForEdit(params: {
  editedEnd: EventTime;
  editedStart: EventTime;
  masterEnd: EventTime;
  masterStart: EventTime;
}): { end: EventTime; start: EventTime } | null {
  const { editedEnd, editedStart, masterEnd, masterStart } = params;
  const timeZone = zoneOf(editedStart, masterStart);
  const day = dayOfStart(masterStart, timeZone);
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
